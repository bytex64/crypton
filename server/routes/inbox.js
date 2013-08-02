/* Crypton Server, Copyright 2013 SpiderOak, Inc.
 *
 * This file is part of Crypton Server.
 *
 * Crypton Server is free software: you can redistribute it and/or modify it
 * under the terms of the Affero GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Crypton Server is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the Affero GNU General Public
 * License for more details.
 *
 * You should have received a copy of the Affero GNU General Public License
 * along with Crypton Server.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

var app = process.app;
var middleware = require('../lib/middleware');
var verifySession = middleware.verifySession;
var Inbox = require('../lib/inbox');

/**!
 * ### GET /inbox
 * Get all messages for the current session's `accountId`
*/
app.get('/inbox', verifySession, function (req, res) {
  app.log('debug', 'handling GET /inbox');

  var id = req.session.accountId;
  var inbox = new Inbox(id);

  inbox.getAllMessages(function (err, messages) {
    if (err) {
      res.send({
        success: false,
        error: err
      });
      return;
    }

    res.send({
      success: true,
      messages: messages
    });
  });
});

/**!
 * ### GET /inbox/:messageIdentifier
 * Get specific message for the current session's `accountId` by `messageIdentifier`
*/
app.get('/inbox/:messageIdentifier', verifySession, function (req, res) {
  app.log('debug', 'handling GET /inbox/:messageIdentifier');
});

/**!
 * ### DEL /inbox/:messageIdentifier
 * Delete specific message for the current session's `accountId` by `messageIdentifier`
*/
// TODO should this be deleted in lieu of a transaction?
app.del('/inbox/:messageIdentifier', verifySession, function (req, res) {
  app.log('debug', 'handling DEL /container/:containerNameHmac');
});