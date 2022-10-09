const { gql, ApolloError } = require('apollo-server')

const get = require('lodash/get')
const microservice = require('..')
const { items } = require('../items')
const bankDiscount = microservice.config.get('settings.bankDetails.discount')
const shippingFees = require('../argentinaZips.json')
const typeDefs = gql`
  extend type Query {
    cart: Cart
  }

  extend type Mutation {
    addShipping(zip: Int): Cart
    setBankTransfer(bankTransfer: Boolean): Cart
    addToCart(_id: ID!, quantity: Int): Cart
    removeFromCart(_id: ID!): Cart
  }

  type Cart {
    token: String
    breakdown: Breakdown
    address: ShippingAddress
    cart: [Item]
  }

  type ShippingAddress {
    zip: Int
    area: String
    method: ShippingMethod
  }

  type ShippingMethod {
    name: String
    id: String
  }

  type Breakdown {
    discount: Int
    total: Int
    subtotal: Int
    taxes: Int
    shipping: Int
    currency: String
  }

  input InputItem {
    _id: ID!
    quantity: Int
  }

  type Item {
    _id: ID
    name: String
    image: String
    quantity: Int
    currency: String
    price: Int
  }
`

const getShippingArea = (zip) => {
  for (let area of shippingFees) if (area.zipList.indexOf(zip) > -1) return area
}

const processCart = async (cart, fees, address, bankTransfer) => {
  let cartItems = await items(cart.map(({ _id }) => _id))
  cartItems = cartItems.map((item) => {
    const cartItem = cart.find((i) => i._id == item._id)
    item.quantity = cartItem ? cartItem.quantity : 0

    return item
  })
  const shippingFee = fees && fees.shipping ? fees.shipping : 0
  const subtotal = cartItems.reduce(
    (acc, { _id, price, quantity }) => acc + price * quantity,
    0
  )
  return {
    breakdown: {
      subtotal,
      shipping: shippingFee,
      total:
        (bankTransfer ? Math.ceil(subtotal * (1 - bankDiscount)) : subtotal) +
        shippingFee,
      discount: bankTransfer ? Math.ceil(subtotal * bankDiscount) : 0
    },
    address,
    token: microservice.sign({ cart, fees, address, bankTransfer }),
    cart: cartItems
  }
}

const getSource = (origin = '') => {
  if (origin.indexOf('utm_source=IGShopping') > -1) return 'instagram'
  if (origin.indexOf('fbclid') > -1) return 'facebook'
  if (origin.indexOf('utm_source=whatsapp') > -1) return 'whatsapp'

  return
}

const resolvers = {
  Query: {
    cart: (_, __, { session }) => {
      let sessionCart = get(session, 'cart') || []
      let fees = get(session, 'fees') || {}
      let address = get(session, 'address') || {}
      let bankTransfer = get(session, 'bankTransfer')
      return processCart(sessionCart, fees, address, bankTransfer)
    }
  },
  Mutation: {
    addToCart: (_, { _id }, { session }) => {
      let cart = get(session, 'cart') || []
      let fees = get(session, 'fees') || {}
      let address = get(session, 'address') || {}
      let bankTransfer = get(session, 'bankTransfer')

      const index = cart.findIndex((item) => item._id == _id)
      if (index == -1) cart.push({ _id, quantity: 1 })
      else {
        const q = cart[index].quantity || 0
        cart[index].quantity = q + 1
      }

      return processCart(cart, fees, address, bankTransfer)
    },
    setBankTransfer: (_, { bankTransfer }, { session }) => {
      let cart = get(session, 'cart') || []
      let fees = get(session, 'fees') || {}
      let address = get(session, 'address') || {}

      return processCart(cart, fees, address, bankTransfer)
    },
    addShipping: (_, { zip }, { session }) => {
      let cart = get(session, 'cart') || []
      let fees = get(session, 'fees') || {}
      let address = get(session, 'address') || {}
      let bankTransfer = get(session, 'bankTransfer')

      if (zip) {
        const shippingArea = getShippingArea(zip)
        if (!shippingArea) return new ApolloError('Shipping not found')
        fees.shipping = shippingArea.price
        address = {
          method: shippingArea.method,
          area: shippingArea.area,
          zip
        }
      } else {
        fees.shipping = 0
        address = {}
      }

      return processCart(cart, fees, address, bankTransfer)
    },
    removeFromCart: (_, { _id }, { session }) => {
      let cart = get(session, 'cart') || []
      let fees = get(session, 'fees') || {}
      let address = get(session, 'address') || {}
      let bankTransfer = get(session, 'bankTransfer')

      const index = cart.findIndex((item) => item._id == _id)

      if (index > -1) {
        const q = cart[index].quantity || 1
        if (q == 1) cart.splice(index, 1)
        else cart[index].quantity = q - 1
      }

      if (!cart.length) return { cart: [] }
      return processCart(cart, fees, address, bankTransfer)
    }
  }
}

module.exports = { typeDefs, resolvers }
