#!/usr/bin/env node

/**
 * Claude API 连接测试脚本
 * 使用方法：
 * 1. 设置环境变量：
 *    export CLAUDE_API_KEY="your-api-key"
 *    export CLAUDE_BASE_URL="https://your-base-url"  # 可选，默认是 Anthropic 官方地址
 * 2. 运行：node test-claude-api.js
 */

const https = require('https');
const http = require('http');

// 从环境变量读取配置
const API_KEY = process.env.CLAUDE_API_KEY || '';
const BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

console.log('=== Claude API 连接测试 ===\n');
console.log('配置信息:');
console.log(`  Base URL: ${BASE_URL}`);
console.log(`  API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' + API_KEY.slice(-4) : '(未设置)'}`);
console.log(`  Model: ${MODEL}\n`);

if (!API_KEY) {
  console.error('❌ 错误: 未设置 CLAUDE_API_KEY 环境变量');
  console.log('\n使用方法:');
  console.log('  export CLAUDE_API_KEY="your-api-key"');
  console.log('  export CLAUDE_BASE_URL="https://your-base-url"  # 可选');
  console.log('  node test-claude-api.js\n');
  process.exit(1);
}

// 构造请求
const url = new URL('/v1/messages', BASE_URL);
const isHttps = url.protocol === 'https:';
const httpModule = isHttps ? https : http;

const requestBody = JSON.stringify({
  model: MODEL,
  max_tokens: 100,
  messages: [
    {
      role: 'user',
      content: '你好，请回复"连接成功"'
    }
  ]
});

const options = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': API_KEY,
    'Content-Length': Buffer.byteLength(requestBody)
  }
};

console.log('正在测试连接...\n');

const startTime = Date.now();

const req = httpModule.request(options, (res) => {
  const duration = Date.now() - startTime;
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`请求完成 (耗时: ${duration}ms)`);
    console.log(`状态码: ${res.statusCode}\n`);

    if (res.statusCode === 200) {
      try {
        const response = JSON.parse(data);
        console.log('✅ 连接成功！\n');
        console.log('API 响应:');
        console.log(`  ID: ${response.id}`);
        console.log(`  Model: ${response.model}`);
        console.log(`  角色: ${response.role}`);
        if (response.content && response.content[0]) {
          console.log(`  内容: ${response.content[0].text}`);
        }
        console.log(`\n使用统计:`);
        console.log(`  输入 tokens: ${response.usage?.input_tokens || 0}`);
        console.log(`  输出 tokens: ${response.usage?.output_tokens || 0}`);
      } catch (error) {
        console.log('✅ API 连接成功，但响应解析失败');
        console.log('原始响应:', data.substring(0, 500));
      }
    } else {
      console.log('❌ 连接失败\n');
      console.log('错误响应:');
      try {
        const error = JSON.parse(data);
        console.log(JSON.stringify(error, null, 2));
      } catch {
        console.log(data);
      }
    }
  });
});

req.on('error', (error) => {
  console.log('❌ 请求失败\n');
  console.log('错误信息:', error.message);

  if (error.code === 'ENOTFOUND') {
    console.log('\n可能的原因:');
    console.log('  - Base URL 地址错误');
    console.log('  - 网络连接问题');
    console.log('  - DNS 解析失败');
  } else if (error.code === 'ECONNREFUSED') {
    console.log('\n可能的原因:');
    console.log('  - 服务器拒绝连接');
    console.log('  - Base URL 端口错误');
  }
});

req.on('timeout', () => {
  console.log('❌ 请求超时');
  req.destroy();
});

req.setTimeout(30000); // 30秒超时
req.write(requestBody);
req.end();
