const { gql } = require('apollo-server')
const moment = require('moment')
const ms = require('..')
const { model } = ms
const { Order } = model
const PAGE_SIZE = ms.config.get('settings.app.pageSize')
const typeDefs = gql`
  extend type Query {
    order(_id: ID!): Order
    orders(
      offset: Int
      size: Int
      sort: String
      dateFrom: String
      dateTo: String
      status: String
      customer: String
    ): [Order]

    sales(type: String): [SaleStats]
    progress: OrderStats
  }

  extend type Mutation {
    insertOrder: Order
    updateOrder(_id: ID!, status: String): Order
    removeOrder: Order
  }

  type SaleStats {
    _id: ID
    count: Int
    total: Int
  }
  type OrderStats {
    count: Int
    done: Int
    inProgress: Int
    byStatus: [StatusStats]
  }

  type StatusStats {
    status: ID
    count: Int
  }

  type Order {
    _id: ID
    id: ID
    status: String
    customer: Customer
    shipment: Shipment
    items: [Item]
    date: String
    total: Float
    transaction: Transaction
    comment: String
  }

  type Customer {
    name: String
    phone: String
    email: String
    identification: String
    address: Address
  }

  type Shipment {
    name: String
    phone: String
    cost: Int
    address: Address
  }
`

const initiateStats = (type) => {
  const stats = []
  if (type == 'week') {
    const currentDay = moment().subtract(7, 'days')

    for (let i = 0; i < 7; i++) {
      stats.push({
        _id: currentDay.add(1, 'days').format('YYYY-MM-DD'),
        count: 0,
        total: 0
      })
    }
  }

  if (type == 'month') {
    const currentDay = moment().subtract(30, 'days').date(moment().date())

    for (let i = 0; i < 30; i++) {
      stats.push({
        _id: currentDay.add(1, 'days').format('YYYY-MM-DD'),
        count: 0,
        total: 0
      })
    }
  }

  if (type == 'year') {
    const currentMonth = moment().subtract(12, 'months')

    for (let i = 0; i < 12; i++) {
      stats.push({
        _id: currentMonth.add(1, 'month').format('YYYY-MM'),
        count: 0,
        total: 0
      })
    }
  }

  return stats
}

const resolvers = {
  Query: {
    order: (_, { _id }) =>
      Order.findOne({ _id }).populate('transaction').exec(),
    progress: async () => {
      const result = await Order.aggregate([
        {
          $match: {
            date: {
              $gte: moment().subtract(30, 'days').toDate(),
              $lte: moment().toDate()
            }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])

      return result.reduce(
        (acc, { _id, count }) => {
          acc.count += count
          if (_id == 'done') acc.done += count
          if (['pending', 'new'].indexOf(_id) > -1) acc.inProgress += count
          acc.byStatus.push({ status: _id, count })
          return acc
        },
        { count: 0, done: 0, inProgress: 0, byStatus: [] }
      )
    },
    sales: async (_, { type = 'week' }) => {
      const stats = initiateStats(type)
      const result = await Order.aggregate([
        {
          $match: {
            status: { $ne: 'cancelled' },
            date: {
              $gte: new Date(stats[0]._id),
              $lte: new Date(stats[stats.length - 1]._id)
            }
          }
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: '$date' },
              month: { $month: '$date' },
              year: { $year: '$date' }
            },
            total: { $sum: '$total' },
            count: { $sum: 1 }
          }
        }
      ])
      result.forEach(({ _id, count, total }) => {
        const stat = stats.find(
          (stat) =>
            stat._id ==
            `${_id.year}-${
              (_id.month.toString().length == 1 ? '0' : '') +
              _id.month.toString()
            }-${
              (_id.day.toString().length == 1 ? '0' : '') + _id.day.toString()
            }`
        )

        if (stat) {
          stat.count = count
          stat.total = total
        }
      })

      return stats
    },

    orders: (
      _,
      {
        offset = 0,
        size = PAGE_SIZE,
        sort = '-date',
        dateFrom,
        dateTo,
        customer,
        ...order
      }
    ) => {
      if (dateFrom || dateTo)
        order.date = {
          $gte: `${dateFrom}T00:00:00`,
          $lte: `${dateTo}T23:59:59`
        }

      if (customer) order['customer.email'] = new RegExp(customer)

      return Order.find(order).sort(sort).skip(offset).limit(size).exec()
    }
  },
  Mutation: {
    insertOrder: (_, order) => new Order(order).save(),
    updateOrder: (_, { _id, ...order }) =>
      Order.findOneAndUpdate({ _id }, order, { new: true })
        .populate('transaction')
        .exec(),
    removeOrder: (_, { _id }) => Order.findOneAndRemove({ _id }).exec()
  }
}

module.exports = { typeDefs, resolvers }
