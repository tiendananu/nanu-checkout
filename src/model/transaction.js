const { Schema } = require('mongoose')
const { config } = require('..')

module.exports = new Schema({
  id: String,
  status: {
    type: String,
    enum: ['draft', 'created', 'pending', 'approved', 'rejected'],
    default: 'draft'
  },
  detail: String,
  date: { type: Date, default: Date.now() },
  email: String,
  payer: {
    name: String,
    phone: String,
    identification: String,
    address: {
      street: String,
      number: String,
      apartment: String,
      zip: String,
      city: String,
      state: String,
      country: String
    }
  },
  amount: Number,
  currency_id: String,
  paymentMethod: String,
  paymentType: String
})
