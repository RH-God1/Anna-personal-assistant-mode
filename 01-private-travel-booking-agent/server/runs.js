const runs = new Map();

function createRun(input) {
  const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const run = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: "created",
    events: [],
    ...input
  };

  runs.set(id, run);
  return run;
}

function getRun(id) {
  return runs.get(id) || null;
}

function appendEvent(id, event) {
  const run = getRun(id);

  if (!run) {
    const error = new Error(`Run not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }

  const entry = {
    at: new Date().toISOString(),
    ...event
  };

  run.events.push(entry);
  run.updatedAt = entry.at;
  return run;
}

function updateRun(id, patch) {
  const run = getRun(id);

  if (!run) {
    const error = new Error(`Run not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }

  Object.assign(run, patch, {
    updatedAt: new Date().toISOString()
  });
  return run;
}

module.exports = {
  createRun,
  getRun,
  appendEvent,
  updateRun
};
