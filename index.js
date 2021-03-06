#!/usr/bin/env node
'use strict';
require('dotenv').config();
const containerized = require('containerized');
const debug = require('debug')('collector');
const mongoose = require('mongoose');
const Rascal = require('rascal');
const rascalConfig = require('./rascal-config');
const rabbitHelper = require('rabbit-helper');

// Configure host name for mongo
var defaultHost = 'localhost';
if (containerized()) {
    defaultHost = '172.17.0.1';
}

const mongodbHost = process.env.MONGODB_HOST || defaultHost;
debug('MongoDB host:', mongodbHost);

mongoose.Promise = global.Promise;
mongoose.connect('mongodb://' + mongodbHost + '/collector', {
    useMongoClient: true
});

const LogEntry = mongoose.model('Log entry', new mongoose.Schema({
    _id: Number,
    topic: String,
    payload: String
}, { collection: 'log' }));

function init() {
    debug('Config AMQP hosts:', rascalConfig.hosts);
    rabbitHelper.selectRabbits(rascalConfig.hosts, 'subscriber', (hostName) => {
        debug('Selected AMQP host(s):', hostName);
        // Connect to AMQP with Rascal
        Rascal.Broker.create(Rascal.withDefaultConfig(rascalConfig.withRabbit(hostName)), function (err, broker) {
            if (err) {
                debug('Error ', err);
                process.exit(1);
                return;
            }
            debug('Collector is now UP!');

            broker.on('error', function(err) {
                console.error('Broker error', err);
                process.exit(1);
            });

            broker.subscribe('s1', function (err, subscription) {
                if (err) {
                    debug('Error ', err);
                    return;
                }

                subscription.on('message', function (msg, content, ackOrNack) {
                    debug('msg received :', msg.content.toString());
                    let logEntry = new LogEntry({
                        _id: '' + Date.now() + Math.ceil(Math.random() * 100),
                        topic: msg.fields.routingKey,
                        payload: msg.content.toString()
                    });

                    // Skip system messages
                    if (msg.fields.routingKey.indexOf('$') >= 0) {
                        ackOrNack();
                        return;
                    }

                    logEntry.save((err, doc) => {
                        if (err) {
                            debug('Error saving:', err);
                        }
                        debug('Saved to mongo, doc:', err, doc);
                        ackOrNack();
                    });
                }).on('error', console.error);
            }).on('error', console.error);
        });
    }, () => process.exit(1));
}

init();
