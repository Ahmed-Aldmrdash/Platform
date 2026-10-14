'use strict';

const express = require('express');

const router = express.Router();

router.use(require('./sessions'));
router.use(require('./attendance'));
router.use(require('./report'));
router.use(require('./excel'));

module.exports = router;
