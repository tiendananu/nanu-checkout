const { Schema, model } = require('mongoose')

const Order = new Schema({
  id: Number,
  items: [
    {
      quantity: Number,
      price: String,
      currency: String,
      _id: String,
      name: String,
      image: String
    }
  ],
  customer: {
    email: String,
    name: String,
    phone: String,
    identification: String,
    address: {
      street: String,
      number: String,
      apartment: String,
      zip: String,
      city: String,
      state: String
    }
  },
  shipment: {
    cost: Number,
    name: String,
    phone: String,
    address: {
      street: String,
      number: String,
      apartment: String,
      zip: String,
      city: String,
      state: String
    }
  },
  date: { type: Date, default: Date.now() },
  transaction: { type: String, ref: 'Transaction' },
  total: Number,
  status: {
    type: String,
    default: 'new',
    enum: ['new', 'pending', 'cancelled', 'done']
  },
  comment: String
})

Order.pre('save', function (next) {
  var doc = this
  doc.id = Math.ceil(Math.random() * 1000)
  return next()
})

module.exports = Order
