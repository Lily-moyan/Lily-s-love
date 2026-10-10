// 运行级事件总线：SSE 订阅者实时接收节点状态事件
const buses = new Map(); // runId -> { events: [], waiters: [] }

export function createBus(runId) {
  buses.set(runId, { events: [], waiters: [] });
}

export function getBus(runId) {
  return buses.get(runId);
}

export function publish(runId, event) {
  const b = buses.get(runId);
  if (!b) return;
  b.events.push(event);
  const waiters = b.waiters;
  b.waiters = [];
  for (const w of waiters) w(event);
}

export function closeBus(runId) {
  const b = buses.get(runId);
  if (!b) return;
  for (const w of b.waiters) w({ type: 'done' });
  buses.delete(runId);
}
