'use strict';

const stores = require('../data/stores');

/** Read-only accessors the chatbot, reports and dashboards pull live data from. */
function chatbotData() {
  return {
    employees: stores.readEmployees,
    trainings: stores.readTrainings,
    hazards: stores.readHazards,
    permits: stores.getPermitsArray,
    penalties: stores.readPenalties,
    drills: stores.readDrills,
    appUsers: stores.readUsers,
    inspectionSections: () => stores.readInspectionSections() || [],
    inspectionItems: () => stores.readInspectionItems() || [],
    inspectionRecords: () => stores.readInspectionRecords() || [],
    trainingRequests: stores.readTrainingRequests,
  };
}

module.exports = { chatbotData };
