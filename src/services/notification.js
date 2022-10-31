const ms = require('..')
const get = require('lodash/get')
const { model, config } = ms
const { Transaction, Order } = model
const mercadopago = require('mercadopago')
mercadopago.configure({
  access_token: config.get('mercadopago.accessToken')
})

module.exports = {
  post: async (req, res) => {
    res.status(200).end()
    ms.monitor.log('Webhook received', 'WEBHOOK', {
      body: req.body,
      query: req.query
    })
    if (get(req, 'query.topic') == 'payment') {
      const payment = await mercadopago.payment
        .findById(get(req, 'query.id'))
        .then(({ body }) => body)
        .catch((err) => console.error(err))

      const {
        status,
        status_detail,
        transaction_details,
        currency_id,
        external_reference
      } = payment
      const transaction = await Transaction.findOne({
        _id: external_reference
      }).exec()

      if (!transaction) return
      if (transaction.status == 'approved') return
      if (status == 'rejected') {
        transaction.status = status
        transaction.detail = status_detail
        transaction.amount = transaction_details.total_paid_amount
        transaction.currency_id = currency_id

        transaction.save()
      } else if (status == 'approved') {
        transaction.status = status
        transaction.detail = status_detail
        transaction.amount = transaction_details.total_paid_amount
        transaction.currency_id = currency_id

        transaction.save()

        const preference = await mercadopago.preferences
          .findById(transaction.id)
          .then((data) => data.body)
        const shipmentAddress =
          get(preference, 'shipments.receiver_address') || {}
        const shipmentCost = get(preference, 'shipments.cost') || 0
        let additional_info = {}
        try {
          additional_info = JSON.parse(get(preference, 'additional_info'))
        } catch (e) {}
        const order = await new Order({
          transaction: transaction._id,
          total: transaction.amount,
          items: preference.items.map(
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
            cost: shipmentCost,
            name: additional_info.receiver_name,
            phone: additional_info.receiver_phone,
            address: {
              zip: shipmentAddress.zip_code,
              street: shipmentAddress.street_name,
              number: shipmentAddress.street_number,
              apartment: shipmentAddress.apartment,
              city: shipmentAddress.city_name,
              state: shipmentAddress.state_name
            }
          },
          customer: {
            email: preference.payer.email,
            identification: preference.payer.identification.number
          },
          comment: additional_info.comment
        }).save()

        await ms.mail.send(order.customer.email, 'orderConfirmed', {
          order: JSON.stringify(order)
        })
        await ms.mail.send(
          config.get('settings.app.notificationEmail'),
          'orderIncoming',
          {
            order: JSON.stringify(order)
          }
        )
      }
    }
  }
}

const a = {
  additional_info: '',
  auto_return: 'all',
  back_urls: {
    failure: 'http://localhost:3000/checkout/failure',
    pending: 'http://localhost:3000/checkout/pending',
    success: 'http://localhost:3000/checkout/success'
  },
  binary_mode: false,
  client_id: '6503409996351622',
  collector_id: 583692898,
  coupon_code: null,
  coupon_labels: null,
  date_created: '2020-08-07T18:13:39.413+00:00',
  date_of_expiration: null,
  expiration_date_from: null,
  expiration_date_to: null,
  expires: false,
  external_reference: '5f2d99d1e2375a1bf5f66196',
  id: '583692898-53f9ce86-82a7-4cbd-9af4-bc292c5dba7f',
  init_point:
    'https://www.mercadopago.com/mla/checkout/pay?pref_id=583692898-53f9ce86-82a7-4cbd-9af4-bc292c5dba7f',
  internal_metadata: null,
  items: [
    {
      id: '5eff88ec8cab7860ceba949f',
      category_id: '',
      currency_id: 'ARS',
      description: '',
      picture_url:
        'https://res.cloudinary.com/dfeyswrng/image/upload/v1593805029/beeqs8x4sgc2g7usztxm.jpg',
      title: 'Lampara muy bonita',
      quantity: 1,
      unit_price: 12312
    },
    {
      id: '5f004b5f0141a76ca5622590',
      category_id: '',
      currency_id: 'ARS',
      description: '',
      picture_url:
        'https://res.cloudinary.com/dfeyswrng/image/upload/v1593854794/mohozhyjvpkkehmlujl0.jpg',
      title: 'Otra lámpara',
      quantity: 1,
      unit_price: 1233
    }
  ],
  marketplace: 'NONE',
  marketplace_fee: 0,
  metadata: {},
  notification_url: 'https://webhook.site/ff2c6fb5-35cc-4224-97e2-ce31ce0989ca',
  operation_type: 'regular_payment',
  payer: {
    phone: { area_code: '', number: '35677086259' },
    address: {
      zip_code: '123',
      street_name: 'Triq Sant Anna',
      street_number: '123'
    },
    email: 'jibadano@gmail.com',
    identification: { number: '', type: '' },
    name: 'Juan Badano',
    surname: '',
    date_created: null,
    last_purchase: null
  },
  payment_methods: {
    default_card_id: null,
    default_payment_method_id: null,
    excluded_payment_methods: [{ id: '' }],
    excluded_payment_types: [{ id: '' }],
    installments: null,
    default_installments: null
  },
  processing_modes: null,
  product_id: null,
  redirect_urls: { failure: '', pending: '', success: '' },
  sandbox_init_point:
    'https://sandbox.mercadopago.com/mla/checkout/pay?pref_id=583692898-53f9ce86-82a7-4cbd-9af4-bc292c5dba7f',
  site_id: 'MLA',
  shipments: {
    mode: 'custom',
    default_shipping_method: null,
    cost: 300,
    receiver_address: {
      zip_code: '123',
      street_name: 'Triq Sant Anna',
      street_number: '123',
      floor: '',
      apartment: '',
      city_name: 'Malta',
      state_name: 'Floariana',
      country_name: null
    }
  },
  total_amount: null,
  last_updated: null
}
