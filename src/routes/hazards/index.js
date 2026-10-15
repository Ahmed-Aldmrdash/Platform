'use strict';

const express = require('express');

const router = express.Router();

router.use(require('./reports'));
router.use(require('./forward'));
router.use(require('./update'));
router.use(require('./lifecycle'));
router.use(require('./export'));
router.use(require('./alert-settings'));

module.exports = router;
