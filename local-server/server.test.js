const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 创建临时测试目录
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-test-'));
const testStorePath = path.join(testDir, 'batch-store.json');

// 模拟 loadBatchStore 和 saveBatchStore（待实现）
function loadBatchStore(storePath) {
  if (!fs.existsSync(storePath)) {
    return { version: '1.0', jobs: {}, activeJobId: null, downloadHistory: {} };
  }
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

function saveBatchStore(store, storePath) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

// Test 1: 初次加载应返回空结构
const store1 = loadBatchStore(testStorePath);
assert.strictEqual(store1.version, '1.0');
assert.deepStrictEqual(store1.jobs, {});
assert.strictEqual(store1.activeJobId, null);
console.log('✅ Test 1: 初次加载返回默认结构');

// Test 2: 保存后再加载应获得相同数据
const mockStore = {
  version: '1.0',
  jobs: {
    'batch-123': { batchId: 'batch-123', status: 'running' }
  },
  activeJobId: 'batch-123',
  downloadHistory: { 'BV1xx': { bvid: 'BV1xx', downloadedAt: Date.now() } }
};
saveBatchStore(mockStore, testStorePath);
const store2 = loadBatchStore(testStorePath);
assert.deepStrictEqual(store2, mockStore);
console.log('✅ Test 2: 保存后加载数据一致');

// 清理
fs.rmSync(testDir, { recursive: true });
console.log('✅ 所有测试通过');
