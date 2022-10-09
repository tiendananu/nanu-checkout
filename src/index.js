require('dotenv').config()
const Microservice = require('@jibadano/microservice')

const ms = new Microservice(process.env.CONFIG_URL)

ms.init()

module.exports = ms
