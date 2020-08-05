/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
chai.use(require('chai-spies'))
const expect = chai.expect
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const pDefer = require('p-defer')
const pWaitFor = require('p-wait-for')
const times = require('lodash/times')

const FloodSub = require('../src')
const {
  defOptions,
  first,
  expectSet
} = require('./utils')

const { createPeers } = require('./utils/create-peer')

function shouldNotHappen (_) {
  expect.fail()
}

describe('basics between 2 nodes', () => {
  describe('fresh nodes', () => {
    let peerA, peerB
    let fsA, fsB

    // Mount pubsub protocol
    before(async () => {
      [peerA, peerB] = await createPeers({ number: 2 })

      fsA = new FloodSub(peerA, defOptions)
      fsB = new FloodSub(peerB, defOptions)

      expect(fsA.peers.size).to.be.eql(0)
      expect(fsA.subscriptions.size).to.eql(0)
      expect(fsB.peers.size).to.be.eql(0)
      expect(fsB.subscriptions.size).to.eql(0)
    })

    // Start pubsub
    before(() => Promise.all([
      fsA.start(),
      fsB.start()
    ]))

    // Connect floodsub nodes
    before(async () => {
      await peerA.dialProtocol(peerB.peerId, FloodSub.multicodec)

      // Wait for peers to be ready in pubsub
      await pWaitFor(() => fsA.peers.size === 1 && fsB.peers.size === 1)
    })

    after(() => {
      return Promise.all([
        fsA.started && fsA.stop(),
        fsB.started && fsB.stop()
      ])
    })

    it('Subscribe to a topic:Z in nodeA', () => {
      const topic = 'Z'
      const defer = pDefer()

      fsA.subscribe(topic)
      fsB.once('floodsub:subscription-change', (changedPeerId, changedSubs) => {
        expectSet(fsA.subscriptions, [topic])
        expect(fsB.peers.size).to.equal(1)
        expectSet(fsB.topics.get(topic), [fsA.peerId.toB58String()])
        expect(changedPeerId.toB58String()).to.equal(first(fsB.peers).id.toB58String())
        expect(changedSubs).to.be.eql([{ topicID: topic, subscribe: true }])
        defer.resolve()
      })

      return defer.promise
    })

    it('Publish to a topic:Z in nodeA', () => {
      const defer = pDefer()

      fsA.once('Z', (msg) => {
        expect(uint8ArrayToString(msg.data)).to.equal('hey')
        fsB.removeListener('Z', shouldNotHappen)
        defer.resolve()
      })

      fsB.once('Z', shouldNotHappen)

      fsA.publish('Z', uint8ArrayFromString('hey'))

      return defer.promise
    })

    it('Publish to a topic:Z in nodeB', () => {
      const defer = pDefer()

      fsA.once('Z', (msg) => {
        fsA.once('Z', shouldNotHappen)
        expect(uint8ArrayToString(msg.data)).to.equal('banana')

        setTimeout(() => {
          fsA.removeListener('Z', shouldNotHappen)
          fsB.removeListener('Z', shouldNotHappen)

          defer.resolve()
        }, 100)
      })

      fsB.once('Z', shouldNotHappen)

      fsB.publish('Z', uint8ArrayFromString('banana'))

      return defer.promise
    })

    it('Publish 10 msg to a topic:Z in nodeB', () => {
      const defer = pDefer()
      let counter = 0

      fsB.once('Z', shouldNotHappen)
      fsA.on('Z', receivedMsg)

      function receivedMsg (msg) {
        expect(uint8ArrayToString(msg.data)).to.equal('banana')
        expect(msg.from).to.be.eql(fsB.peerId.toB58String())
        expect(msg.seqno).to.be.a('Uint8Array')
        expect(msg.topicIDs).to.be.eql(['Z'])

        if (++counter === 10) {
          fsA.removeListener('Z', receivedMsg)
          fsB.removeListener('Z', shouldNotHappen)

          defer.resolve()
        }
      }
      times(10, () => fsB.publish('Z', uint8ArrayFromString('banana')))

      return defer.promise
    })

    it('Unsubscribe from topic:Z in nodeA', () => {
      const defer = pDefer()
      const topic = 'Z'

      fsA.unsubscribe(topic)
      expect(fsA.subscriptions.size).to.equal(0)

      fsB.once('floodsub:subscription-change', (changedPeerId, changedSubs) => {
        expect(fsB.peers.size).to.equal(1)
        expectSet(fsB.topics.get(topic), [])
        expect(changedPeerId.toB58String()).to.equal(first(fsB.peers).id.toB58String())
        expect(changedSubs).to.be.eql([{ topicID: topic, subscribe: false }])

        defer.resolve()
      })

      return defer.promise
    })

    it('Publish to a topic:Z in nodeA nodeB', () => {
      const defer = pDefer()

      fsA.once('Z', shouldNotHappen)
      fsB.once('Z', shouldNotHappen)

      setTimeout(() => {
        fsA.removeListener('Z', shouldNotHappen)
        fsB.removeListener('Z', shouldNotHappen)
        defer.resolve()
      }, 100)

      fsB.publish('Z', uint8ArrayFromString('banana'))
      fsA.publish('Z', uint8ArrayFromString('banana'))

      return defer.promise
    })
  })

  describe('nodes send state on connection', () => {
    let peerA, peerB
    let fsA, fsB

    // Mount pubsub protocol
    before(async () => {
      [peerA, peerB] = await createPeers({ number: 2 })

      fsA = new FloodSub(peerA, defOptions)
      fsB = new FloodSub(peerB, defOptions)

      expect(fsA.peers.size).to.be.eql(0)
      expect(fsA.subscriptions.size).to.eql(0)
      expect(fsB.peers.size).to.be.eql(0)
      expect(fsB.subscriptions.size).to.eql(0)
    })

    // Start pubsub
    before(() => Promise.all([
      fsA.start(),
      fsB.start()
    ]))

    // Make subscriptions prior to new nodes
    before(() => {
      fsA.subscribe('Za')
      fsB.subscribe('Zb')

      expect(fsA.peers.size).to.equal(0)
      expectSet(fsA.subscriptions, ['Za'])
      expect(fsB.peers.size).to.equal(0)
      expectSet(fsB.subscriptions, ['Zb'])
    })

    after(() => {
      return Promise.all([
        fsA.started && fsA.stop(),
        fsB.started && fsB.stop()
      ])
    })

    it('existing subscriptions are sent upon peer connection', async () => {
      await Promise.all([
        peerA.dialProtocol(peerB.peerId, FloodSub.multicodec),
        new Promise((resolve) => fsA.once('floodsub:subscription-change', resolve)),
        new Promise((resolve) => fsB.once('floodsub:subscription-change', resolve))
      ])

      expect(fsA.peers.size).to.equal(1)
      expect(fsB.peers.size).to.equal(1)

      expectSet(fsA.subscriptions, ['Za'])
      expectSet(fsB.topics.get('Za'), [fsA.peerId.toB58String()])

      expectSet(fsB.subscriptions, ['Zb'])
      expectSet(fsA.topics.get('Zb'), [fsB.peerId.toB58String()])
    })
  })
})
