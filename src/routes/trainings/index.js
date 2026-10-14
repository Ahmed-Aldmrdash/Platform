'use strict';

const express = require('express');

const router = express.Router();

router.use(require('./sessions'));
router.use(require('./attendance'));
router.use(require('./requests').router);
router.use(require('./quiz'));
router.use(require('./media'));
router.use(require('./excel'));

module.exports = router;
