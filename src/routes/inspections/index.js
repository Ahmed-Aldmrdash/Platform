'use strict';

const express = require('express');

const router = express.Router();

router.use(require('./catalogue'));
router.use(require('./excel'));

module.exports = router;
