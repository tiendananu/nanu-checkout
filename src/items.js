const { config } = require('..')
const { gql } = require('apollo-server')
const { ApolloClient, HttpLink, InMemoryCache } = require('apollo-boost')
const fetch = require('isomorphic-unfetch')

const coreEndpoint = config.get('url', 'core')
const client = new ApolloClient({
  link: new HttpLink({
    uri: coreEndpoint + '/graphql',
    credentials: 'same-origin' // Additional fetch() options like `credentials` or `headers`
  }),
  cache: new InMemoryCache().restore({})
})

const items = (items) =>
  client
    .query({
      query: gql`
        query items($items: [ID]!) {
          items(items: $items) {
            _id
            price
            currency
            name
            image
          }
        }
      `,
      variables: { items }
    })
    .then(({ data }) => data.items)
    .catch((error) => console.error(error))

module.exports = {
  items
}
