/**
 * SheetNext Plugin for Super Agent Party
 * 适配主程序插件系统
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXT_DIR = __dirname;
const HTML_FILE = path.join(EXT_DIR, 'index.html');

// 场景①：被主程序以 Node.js 模式启动
if (process.argv[2]) {
  const PLUGIN_PORT = parseInt(process.argv[2], 10);
  const express = require('express');
  const app = express();

  console.log(`[SheetNext] Node.js 插件启动，端口: ${PLUGIN_PORT}`);

  // 基础中间件
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(EXT_DIR));

  // CORS 中间件
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    next();
  });

  // 健康检查（主程序会调用这个）
  app.get('/health', (req, res) => {
    console.log('[SheetNext] 健康检查请求');
    res.json({
      status: 'ok',
      service: 'SheetNext',
      timestamp: new Date().toISOString(),
      port: PLUGIN_PORT
    });
  });

  // AI 代理端点 - 动态获取主程序端口
  app.post('/sheetnextAI', async (req, res) => {
    try {
      console.log('[SheetNext] 收到 AI 请求');
      
      // 动态获取主程序端口
      // 从环境变量或启动参数获取主程序端口
      const MAIN_APP_PORT = process.env.MAIN_APP_PORT || 
                           process.argv[3] || 
                           3456; // 默认值
      
      console.log(`[SheetNext] 主程序端口: ${MAIN_APP_PORT}`);
      
      const fetch = (await import('node-fetch')).default;
      
      // 根据主程序端口动态构建 URL
      const aiServiceUrl = `http://127.0.0.1:${MAIN_APP_PORT}/v1/chat/completions`;
      console.log(`[SheetNext] AI 服务地址: ${aiServiceUrl}`);
      
      // 转发到主程序的 OpenAI 兼容接口
      const response = await fetch(aiServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: req.body.messages || [],
          model: req.body.model || 'super-model',
          stream: true,
          max_tokens: req.body.max_tokens || 4000,
          temperature: req.body.temperature || 0.7,
          enable_thinking: req.body.enable_thinking || false,
          enable_deep_research: req.body.enable_deep_research || false,
          enable_web_search: req.body.enable_web_search || false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SheetNext] AI 请求失败: HTTP ${response.status}`, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // 设置流式响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      console.log('[SheetNext] 开始流式响应');

      // 流式转发
      const reader = response.body;
      let buffer = '';
      
      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                // 转换为 SheetNext 期望的格式
                const sheetnextData = JSON.stringify({ 
                  type: 'text', 
                  delta: content 
                });
                res.write(`data: ${sheetnextData}\n\n`);
              }
            } catch (e) {
              console.error('[SheetNext] 解析错误:', e.message);
              // 继续转发原始行
              res.write(line + '\n');
            }
          } else if (line.trim() !== '') {
            res.write(line + '\n');
          }
        }
      });

      reader.on('end', () => {
        console.log('[SheetNext] 流式响应结束');
        if (buffer) {
          res.write(buffer + '\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });

      reader.on('error', (err) => {
        console.error('[SheetNext] 流错误:', err);
        res.end();
      });

    } catch (error) {
      console.error('[SheetNext] AI 代理错误:', error);
      res.status(500).json({ 
        error: 'AI 服务错误',
        details: error.message 
      });
    }
  });

  // 测试端点 - 检查主程序连接
  app.get('/test-connection', async (req, res) => {
    try {
      const MAIN_APP_PORT = process.env.MAIN_APP_PORT || process.argv[3] || 3456;
      const fetch = (await import('node-fetch')).default;
      
      const response = await fetch(`http://127.0.0.1:${MAIN_APP_PORT}/health`, {
        timeout: 5000
      });
      
      if (response.ok) {
        res.json({ 
          status: 'connected', 
          mainAppPort: MAIN_APP_PORT,
          message: '成功连接到主程序'
        });
      } else {
        res.status(500).json({ 
          status: 'error',
          mainAppPort: MAIN_APP_PORT,
          message: `连接失败: HTTP ${response.status}`
        });
      }
    } catch (error) {
      res.status(500).json({ 
        status: 'error',
        message: `连接错误: ${error.message}`
      });
    }
  });

  // 主页面
  app.get('/', (req, res) => {
    try {
      if (fs.existsSync(HTML_FILE)) {
        let html = fs.readFileSync(HTML_FILE, 'utf-8');
        // 替换端口变量
        html = html.replace(/\{\{PORT\}\}/g, PLUGIN_PORT);
        res.type('html').send(html);
      } else {
        res.status(404).send('HTML file not found');
      }
    } catch (error) {
      res.status(500).send('Error reading HTML file');
    }
  });

  // 404 处理
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // 启动服务器
  const server = app.listen(PLUGIN_PORT, '127.0.0.1', () => {
    const MAIN_APP_PORT = process.env.MAIN_APP_PORT || process.argv[3] || 3456;
    
    console.log(`[SheetNext] ✅ 服务启动成功: http://127.0.0.1:${PLUGIN_PORT}`);
    console.log(`[SheetNext] 📊 健康检查: http://127.0.0.1:${PLUGIN_PORT}/health`);
    console.log(`[SheetNext] 🤖 AI 端点: http://127.0.0.1:${PLUGIN_PORT}/sheetnextAI`);
    console.log(`[SheetNext] 🔗 主程序端口: ${MAIN_APP_PORT}`);
    console.log(`[SheetNext] 🔗 连接测试: http://127.0.0.1:${PLUGIN_PORT}/test-connection`);
    
    // 写入端口文件
    fs.writeFileSync(path.join(EXT_DIR, 'port.log'), String(PLUGIN_PORT));
    fs.writeFileSync(path.join(EXT_DIR, 'main_port.log'), String(MAIN_APP_PORT));
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('[SheetNext] 正在关闭服务...');
    server.close(() => {
      console.log('[SheetNext] 服务已关闭');
      process.exit(0);
    });
  });

} else {
  // 场景②：独立启动（开发模式）
  console.log('[SheetNext] 独立启动模式');
  
  if (!fs.existsSync(HTML_FILE)) {
    console.error('[SheetNext] 错误: index.html 不存在');
    process.exit(1);
  }

  // 启动静态服务器
  const { createServer } = require('http');
  const server = createServer((req, res) => {
    if (req.url === '/') {
      let html = fs.readFileSync(HTML_FILE, 'utf-8');
      html = html.replace(/\{\{PORT\}\}/g, '8080');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      const filePath = path.join(EXT_DIR, req.url);
      if (fs.existsSync(filePath)) {
        res.writeHead(200);
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  server.listen(8080, () => {
    console.log('[SheetNext] 开发服务器: http://localhost:8080');
  });
}
