"use strict";

/*
    PRE-REQUISITES
*/
const { execFileSync, spawn } = require ('child_process');
const connect = require ('socket-retry-connect').waitForSocket;
const dig = require ('node-dig-dns');
const log = require ('./logger.js');

/*
    REQUIREMENTS
*/

execFileSync ('datamkown');

process.on ('SIGINT', () => {
    console.warn ('SIGINT ignored, use SIGTERM to exit.');
});

process.on ('SIGTERM', () => {
    if (KeyDB) KeyDB.kill ();
    if (keydb) keydb.close ();
    if (discovery) clearInterval (discovery);
});

log.debug ('process.argv:', process.argv);
log.debug ('Parsing arguments');
const argv = require ('minimist') (process.argv.slice (2), {
  default: {
    port: 6379,
    interval: 1000
  }
});
log.debug ('argv:', argv);

/*
    MAIN
*/
var KeyDB, keydb, discovery = null;

// server instance
log.info ('Spawning KeyDB server...');
KeyDB = spawn ('keydb-server', [
    '--bind', '0.0.0.0', 
    '--active-replica', 'yes',
    '--replica-read-only', 'no',
    '--multi-master', 'yes',
    '--databases', '1',
    '--dir', '/data',
    '--port', argv.port
], { stdio: ['ignore', 'inherit', 'inherit'] });

// client
log.info ('Connecting as KeyDB client...');
connect ({
    // options
    tries: Infinity,
    port: argv.port
}, 
    // callback
    function start (error, connection) {
        if (error) throw new Error;
        log.info ('KeyDB client connected.');
        keydb = connection;

        // client instance
        keydb.on ('data', (datum) => {
            console.log (datum.toString ());
        });

        // automatic discovery
        const question = 'tasks.' + process.env.SERVICE_NAME + '.';
        const peers = new Set ();
        log.info (`Starting DNS discovery at ${question}`);
        discovery = setInterval (async function discover () {
            const answer = (await dig ([question]))['answer'];
            if (typeof answer == 'undefined') {
                log.info (`No task online.`);
                return;
            }
            const tasks = answer.map (a => a['value']);
            // contrast tasks and peers
            for (let task of tasks) {
                if (!peers.has (task)) {
                    log.info (`Found new peer at ${task}, adding replica...`);
                    await keydb.write (`REPLICAOF ${task} ${argv.port}\n`);
                    peers.add (task);
                    log.info (`Peer at ${task} successfully added as a replica, data may still be transferring.`);
                }
            }
            // cleanup lost peers
            peers.forEach (peer => {
                if (!tasks.includes (peer)) {
                    peers.delete (peer);
                    log.warn (`Peer at ${task} lost.`);
                }
            })
        }, argv.interval);
        
    }
)
