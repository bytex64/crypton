/* Crypton Client, Copyright 2013 SpiderOak, Inc.
 *
 * This file is part of Crypton Client.
 *
 * Crypton Client is free software: you can redistribute it and/or modify it
 * under the terms of the Affero GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Crypton Client is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the Affero GNU General Public
 * License for more details.
 *
 * You should have received a copy of the Affero GNU General Public License
 * along with Crypton Client.  If not, see <http://www.gnu.org/licenses/>.
*/

(function () {

'use strict';

/**!
 * # Container(session)
 *
 * ````
 * var container = new crypton.Container(session);
 * ````
 *
 * @param {Object} session
 */
var Container = crypton.Container = function (session) {
  this.keys = {};
  this.session = session;
  this.recordCount = 1;
  this.recordIndex = 0;
  this.versions = {};
  //this.version = +new Date();
  this.version = 0;
  this.name = null;
};

/**!
 * ### add(key, callback)
 * Add given `key` to the container
 *
 * Calls back without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {String} key
 * @param {Function} callback
 */
Container.prototype.add = function (key, callback) {
  if (this.keys[key]) {
    callback('Key already exists');
    return;
  }

  this.keys[key] = {};
  callback();
};

/**!
 * ### get(key, callback)
 * Retrieve value for given `key`
 *
 * Calls back with `value` and without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {String} key
 * @param {Function} callback
 */
Container.prototype.get = function (key, callback) {
  if (!this.keys[key]) {
    callback('Key does not exist');
    return;
  }

  callback(null, this.keys[key]);
};

/**!
 * ### save(callback, options)
 * Get difference of container since last save (a record),
 * encrypt the record, and send it to the server to be saved
 *
 * Calls back without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {Function} callback
 * @param {Object} options (optional)
 */
Container.prototype.save = function (callback, options) {
  var that = this;
  this.getDiff(function (err, diff) {
    if (!diff) {
      callback('Container has not changed');
      return;
    }

    var payload = {
      recordIndex: that.recordCount,
      delta: diff
    };

    var now = +new Date();
    that.versions[now] = JSON.parse(JSON.stringify(that.keys));
    that.version = now;
    that.recordCount++;

    var rawPayloadCiphertext = sjcl.encrypt(that.sessionKey, JSON.stringify(payload), crypton.cipherOptions);
    var payloadCiphertextHash = sjcl.hash.sha256.hash(JSON.stringify(rawPayloadCiphertext));
    var payloadSignature = that.session.account.signKeyPrivate.sign(payloadCiphertextHash, crypton.paranoia);

    var payloadCiphertext = {
      ciphertext: rawPayloadCiphertext,
      signature: payloadSignature
    };

    var chunk = {
      type: 'addContainerRecord',
      containerNameHmac: that.getPublicName(),
      payloadCiphertext: payloadCiphertext
    };

    if (options && options.save == false) {
      callback(null, chunk);
      return;
    }

    // TODO handle errs
    var tx = new crypton.Transaction(that.session, function (err) {
      tx.save(chunk, function (err) {
        tx.commit(function (err) {
          callback();
        });
      });
    });
  });
};

/**!
 * ### getDiff(callback, options)
 * Compute difference of container since last save
 *
 * Calls back with diff object and without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {Function} callback
 */
Container.prototype.getDiff = function (callback) {
  var last = this.latestVersion();
  var old = this.versions[last] || {};
  callback(null, crypton.diff.create(old, this.keys));
};

/**!
 * ### getVersions()
 * Return a list of known save point timestamps
 *
 * @return {Array} timestamps
 */
Container.prototype.getVersions = function () {
  return Object.keys(this.versions);
};

/**!
 * ### getVersion(version)
 * Return full state of container at given `timestamp`
 *
 * @param {Number} timestamp
 * @return {Object} version
 */
Container.prototype.getVersion = function (timestamp) {
  return this.versions[timestamp];
};

/**!
 * ### getVersion()
 * Return last known save point timestamp
 *
 * @return {Number} version
 */
Container.prototype.latestVersion = function () {
  var versions = this.getVersions();

  if (!versions.length) {
    return this.version;
  } else {
    return Math.max.apply(Math, versions);
  }
};

/**!
 * ### getPublicName()
 * Compute the HMAC for the given name of the container
 *
 * @return {String} hmac
 */
Container.prototype.getPublicName = function () {
  if (this.nameHmac) {
    return this.nameHmac;
  }

  var hmac = new sjcl.misc.hmac(this.session.account.containerNameHmacKey);
  var containerNameHmac = hmac.encrypt(this.name);
  this.nameHmac = sjcl.codec.hex.fromBits(containerNameHmac);
  return this.nameHmac;
};

/**!
 * ### getHistory()
 * Ask the server for all state records
 *
 * Calls back with diff object and without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {Function} callback
 */
Container.prototype.getHistory = function (callback) {
  var containerNameHmac = this.getPublicName();
  var currentVersion = this.latestVersion();

  var url = crypton.url() + '/container/' + containerNameHmac + '?after=' + (currentVersion + 1);
  superagent.get(url)
    .withCredentials()
    .end(function (res) {
      if (!res.body || res.body.success !== true) {
        callback(res.body.error);
        return;
      }

      callback(null, res.body.records);
    });
};

/**!
 * ### parseHistory(records, callback)
 * Loop through given `records`, decrypt them,
 * and build object state from decrypted diff objects
 *
 * Calls back with full container state, history versions,
 * and without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {Array} records
 * @param {Function} callback
 */
Container.prototype.parseHistory = function (records, callback) {
  var keys = this.keys || {};
  var versions = this.versions || {};

  var recordIndex = this.recordIndex + 1;
  for (var i in records) {
    var record = this.decryptRecord(recordIndex++, records[i]);
    keys = crypton.diff.apply(record.delta, keys);
    versions[record.time] = JSON.parse(JSON.stringify(keys));
  }

  callback(null, keys, versions, recordIndex);
};

/**!
 * ### decryptRecord(recordIndex, record)
 * Use symkey to extract session and HMAC keys,
 * decrypt record ciphertext with session key,
 * verify record index
 *
 * @param {Object} recordIndex
 * @param {Object} record
 * @return {Object} decryptedRecord
 */
// TODO handle potential JSON.parse errors here
Container.prototype.decryptRecord = function (recordIndex, record) {
  if (!this.sessionKey) {
    this.decryptKey(record);
  }

  var peer = this.peer || this.session.account;
  var parsedRecord = JSON.parse(record.payloadCiphertext);
  var payloadCiphertextHash = sjcl.hash.sha256.hash(JSON.stringify(parsedRecord.ciphertext));

  var verified;
  try {
    verified = peer.signKeyPub.verify(payloadCiphertextHash, parsedRecord.signature);
  } catch (e) {
    console.log(e);
  }

  if (!verified) {
    throw new Error('Record signaure does not match expected signature');
  }

  var payload = JSON.parse(sjcl.decrypt(this.sessionKey, parsedRecord.ciphertext, crypton.cipherOptions));

  if (payload.recordIndex !== recordIndex) {
    // TODO revisit. this was giving me too much trouble trying to keep state up
    // after I implemented variable date record fetching
    //throw new RangeError('Unexpected recordIndex');
  }

  this.recordIndex++;

  return {
    time: +new Date(record.creationTime),
    delta: payload.delta
  };
};

/**!
 * ### decryptKey(record)
 * Extract and decrypt the container's keys from a given record
 *
 * @param {Object} record
 */
Container.prototype.decryptKey = function (record) {
  var peer = this.peer || this.session.account;
  var sessionKeyRaw = this.session.account.verifyAndDecrypt(JSON.parse(record.sessionKeyCiphertext), peer);

  if (sessionKeyRaw.error) {
    throw new Error(sessionKeyRaw.error);
  }

  if (!sessionKeyRaw.verified) {
    throw new Error('Container session key signature mismatch');
  }

  this.sessionKey = JSON.parse(sessionKeyRaw.plaintext);
};

/**!
 * ### sync(callback)
 * Retrieve history, decrypt it, and update
 * container object with new state
 *
 * Calls back without error if successful
 *
 * Calls back with error if unsuccessful
 * 
 * @param {Function} callback
 */
Container.prototype.sync = function (callback) {
  var that = this;
  this.getHistory(function (err, records) {
    if (err) {
      callback(err);
      return;
    }

    that.parseHistory(records, function (err, keys, versions, recordCount) {
      that.keys = keys;
      that.versions = versions;
      that.version = Math.max.apply(Math, Object.keys(versions));
      that.recordCount = that.recordCount + recordCount;
      callback(err);
    });
  });
};

/**!
 * ### share(peer, callback)
 * Encrypt the container's sessionKey with peer's
 * public key, commit new addContainerSessionKey chunk,
 * and send a message to the peer informing them
 *
 * Calls back without error if successful
 *
 * Calls back with error if unsuccessful
 *
 * @param {Function} callback
 */
Container.prototype.share = function (peer, callback) {
  if (!this.sessionKey) {
    return callback('Container must be initialized to share');
  }

  // get the containerNameHmac
  // TODO this won't work if you aren't original sharer
  // because you won't have the original containerNameHmacKey.
  // we will have to mark containers as origin or remote
  var containerNameHmac = this.getPublicName();

  // encrypt sessionKey to peer's pubKey
  var sessionKeyCiphertext = peer.encryptAndSign(this.sessionKey);

  if (sessionKeyCiphertext.error) {
    return callback(sessionKeyCiphertext.error);
  }

  delete sessionKeyCiphertext.error;

  // create new addContainerSessionKeyShare chunk
  var that = this;
  new crypton.Transaction(this, function (err, tx) {
    var chunk = {
      type: 'addContainerSessionKeyShare',
      toAccount: peer.username,
      containerNameHmac: containerNameHmac,
      sessionKeyCiphertext: sessionKeyCiphertext
    };

    tx.save(chunk, function (err) {
      if (err) {
        return callback(err);
      }

      tx.commit(function (err) {
        if (err) {
          return callback(err);
        }

        // send a message informing peer
        // TODO we will have to add the ability to mark which application
        // this container belongs to, otherwise an application on the same
        // crypton server may incorrectly act upon this message
        peer.sendMessage({
          type: 'internal',
          action: 'containerShare'
        }, {
          fromUsername: that.session.account.username,
          containerNameHmac: containerNameHmac
        }, function (err) {
          callback(err);
        });
      });
    });
  });
};

})();

