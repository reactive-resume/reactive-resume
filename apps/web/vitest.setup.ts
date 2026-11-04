// Node's BroadcastChannel reaches every worker thread in the process, so one test file's account switch would fence
// the account scope of another file running beside it, mid-test. Browsers keep the channel to one origin's tabs; here
// account-scope falls back to storage events, which stay within each file's own window.
Reflect.deleteProperty(globalThis, "BroadcastChannel");
