const { gql } = require('apollo-server')
const get = require('lodash/get')
const moment = require('moment')
const ms = require('..')
const { config, model } = ms
const { Transaction, Order } = model
const mercadopago = require('mercadopago')

const bankDiscount = ms.config.get('settings.bankDetails.discount')
const PAGE_SIZE = ms.config.get('settings.app.pageSize')

mercadopago.configure({
  access_token: config.get('mercadopago.accessToken')
})
const url = config.get('url') || 'http://localhost:9001'
const notificationUrl =
  process.env.NODE_ENV == 'production'
    ? `${url}/notification`
    : 'https://webhook.site/f055486f-c1b9-4b07-9397-c466f5300d85'
const siteUrl = config.get('url', 'web') || 'http://localhost:3000'
const { items: getItemsDetails } = require('../items')

const typeDefs = gql`
  extend type Query {
    transaction(_id: ID!): Transaction
    transactions(
      offset: Int
      size: Int
      sort: String
      dateFrom: String
      dateTo: String
      status: String
    ): [Transaction]
    profit: ProfitStats
  }

  extend type Mutation {
    start(
      email: String
      paymentMethod: String
      shipment: InputShipment
      payer: InputPayer
      comment: String
    ): String
    updateTransaction(_id: ID!, status: String): Transaction
  }
  type ProfitStats {
    previous: Float
    current: Float
  }
  input InputPayer {
    name: String
    phone: String
    identification: String
    address: InputAddress
  }

  input InputShipment {
    name: String
    phone: String
    pickup: Boolean
    address: InputAddress
  }

  input InputAddress {
    street: String
    number: String
    apartment: String
    city: String
    zip: Int
    state: String
  }

  type Address {
    street: String
    number: String
    apartment: String
    city: String
    zip: String
    state: String
  }

  type Payer {
    name: String
    phone: String
    identification: String
    address: Address
  }

  type Transaction {
    _id: ID
    amount: String
    id: String
    status: String
    detail: String
    date: String
    payer: Payer
    paymentMethod: PaymentMethod
    paymentType: PaymentType
  }

  enum PaymentMethod {
    amex
    visa
    master
  }
  enum PaymentType {
    credit_card
    debit_card
  }
`

const getShipment = (session, data) => {
  const fees = get(session, 'fees')
  const { shipment } = data
  if (shipment.pickup) return {}
  return {
    shipments: {
      mode: 'not_specified',
      cost: fees && fees.shipping,
      receiver_address: shipment.pickup
        ? {}
        : {
            zip_code: shipment.address.zip.toString(),
            street_name: shipment.address.street,
            city_name: shipment.address.city,
            state_name: shipment.address.state,
            street_number: parseInt(shipment.address.number),
            apartment: shipment.address.apartment
          }
    },
    additional_info: {
      receiver_name: shipment.name,
      receiver_phone: shipment.phone
    }
  }
}

const getPayer = (data) => {
  const { email, payer } = data

  return {
    email,
    identification: {
      number: payer.identification
    }
  }
}

const getItems = async (session) => {
  let items = await getItemsDetails(
    (get(session, 'cart') || []).map(({ _id }) => _id)
  )

  return items.map(({ price, name, _id, currency, image, quantity = 1 }) => ({
    id: _id,
    title: name,
    unit_price: price,
    currency_id: currency,
    quantity,
    picture_url: image
  }))
}

const resolvers = {
  Query: {
    transaction: (_, { _id }) => Transaction.findOne({ _id }).exec(),
    transactions: (
      _,
      {
        sort = '-date',
        offset = 0,
        size = PAGE_SIZE,
        dateFrom,
        dateTo,
        ...transaction
      }
    ) => {
      if (dateFrom || dateTo)
        transaction.date = {
          $gte: `${dateFrom}T00:00:00`,
          $lte: `${dateTo}T23:59:59`
        }
      return Transaction.find(transaction)
        .sort(sort)
        .skip(offset)
        .limit(size)
        .exec()
    },
    profit: async (_, { _id }) => {
      const today = moment()
      const firstDayOfCurrentMonth = moment()
        .date(1)
        .hour(0)
        .minute(0)
        .second(0)

      const aMonthAgo = moment().month(today.month() - 1)
      const firstDayFromAMonthAgo = moment()
        .month(today.month() - 1)
        .date(1)
        .hour(0)
        .minute(0)
        .second(0)
      const currentPeriod = await Transaction.aggregate([
        {
          $match: {
            status: 'approved',
            date: {
              $gte: firstDayOfCurrentMonth.toDate(),
              $lte: today.toDate()
            }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ])

      const previousPeriod = await Transaction.aggregate([
        {
          $match: {
            status: 'approved',
            date: {
              $gte: firstDayFromAMonthAgo.toDate(),
              $lte: aMonthAgo.toDate()
            }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ])

      return {
        current: currentPeriod[0] && currentPeriod[0].total,
        previous: previousPeriod[0] && previousPeriod[0].total
      }
    }
  },
  Mutation: {
    start: async (_, data, { session }) => {
      const items = await getItems(session)
      const payer = getPayer(data)
      const shipment = getShipment(session, data)

      const transaction = await new Transaction({
        email: data.email,
        payer: data.payer
      })

      if (data.paymentMethod == 'bankTransfer') {
        transaction.status = 'pending'
        transaction.detail = 'Waiting bank transfer'
        const shippingCost = get(shipment, 'shipments.cost') || 0
        transaction.amount = items.reduce(
          (acc, cur) => acc + cur.unit_price * cur.quantity,
          0
        )
        transaction.amount = Math.ceil(transaction.amount * (1 - bankDiscount))
        transaction.amount += shippingCost
        transaction.currency_id = 'ARS'
        await transaction.save()
        const order = await new Order({
          transaction: transaction._id,
          total: transaction.amount,
          items: items.map(
            ({
              id,
              currency_id,
              picture_url,
              title,
              quantity,
              unit_price
            }) => ({
              quantity,
              price: unit_price,
              currency: currency_id,
              _id: id,
              name: title,
              image: picture_url
            })
          ),
          shipment: {
            cost: shippingCost,
            ...data.shipment
          },
          customer: {
            email: payer.email,
            identification: payer.identification.number
          },
          comment: data.comment
        })
          .save()
          .catch((e) => {
            console.log(e)
          })

        ms.mail.send(order.customer.email, 'orderPending', {
          order: JSON.stringify(order)
        })

        ms.mail.send(
          ms.config.get('settings.app.notificationEmail'),
          'orderIncoming',
          {
            order: JSON.stringify(order)
          }
        )

        return `${siteUrl}/checkout/pending?external_reference=${transaction._id}`
      }

      var preference = {
        items,
        payer,
        shipments: shipment.shipments,
        additional_info: JSON.stringify({
          ...shipment.additional_info,
          comment: data.comment
        }),
        external_reference: transaction._id.toString(),
        notification_url: notificationUrl,
        auto_return: 'all',
        back_urls: {
          success: `${siteUrl}/checkout/success`,
          pending: `${siteUrl}/checkout/pending`,
          failure: `${siteUrl}/checkout/failure`
        }
      }

      return mercadopago.preferences
        .create(preference)
        .then((res) => {
          const preference = get(res, 'body')

          transaction.id = preference.id
          transaction.status = 'created'
          transaction.detail = 'waiting for user'

          transaction.save()
          return res
        })
        .then((res) => get(res, 'body.init_point'))
        .catch(console.err)
    },
    updateTransaction: (_, { _id, ...transaction }) =>
      Transaction.findOneAndUpdate({ _id }, transaction, { new: true }).exec()
  }
}

module.exports = { typeDefs, resolvers }
