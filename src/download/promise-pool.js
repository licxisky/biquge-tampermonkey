// Promise Pool 并发控制模块
// 功能：控制并发请求数量

export async function promisePool(tasks, concurrency) {
  const executing = [];

  for (const task of tasks) {
    const p = Promise.resolve(task()).then(result => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });

    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export const PromisePool = {
  execute: promisePool
};
