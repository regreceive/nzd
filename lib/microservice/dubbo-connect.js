'use strict';
const net = require('net');
const dubboConfig = require('./../../config/dubbo-connect');
const log = require('./../../logs/index').logger("dubbo-connect");
const requests = new Map();
const clients = new Map();

var sequence = 0x0; // 针对所有连接的序列

/**
 * 连接dubbo的结构体
 */
class Client {
  /**
   *
   * @param key {String}
   * @param socket {Socket}
   * @param lock {boolean}
   * @param retires {int}
   */
  constructor(key, socket, lock = false, retries = 0) {
    this.key = key;
    this.socket = socket;
    this.lock = lock;
    this.retries = retries;
    this.queue = [];  // 里面缓存请求数据buffer，因为在大并发下socket.write同时连续写入会造成合包现象
  }
}

/**
 * 请求处理结构体
 */
class Request {
  /**
   *
   * @param seq {int}
   * @param resolve {Function}
   * @param reject {Function}
   * @param offset {int}
   * @param length {int}
   */
  constructor(seq, resolve, reject, offset = 0, length = 0) {
    this.seq = seq;
    this.resolve = resolve;
    this.reject = reject;
    this.offset = offset;
    this.length = length;
    this.state = 0; // 0 waiting, 1 pending, 2 sending, 3 receiving, 4 done
    this.timestamp = new Date().getTime();
  }
}


var ResBuffer = {
  buffer: Buffer.alloc(dubboConfig.resBufferSize),
  pointer: 0,
  /**
   * 申请缓冲空间
   * @param request {Object}
   * @param size {Integer}
   */
  alloc(request, size) {
    // 缓冲已满不再处理
    if (this.pointer + size > dubboConfig.resBufferSize) {
      log.warn('Exceed maximal size of response buffer.');
      throw 'Exceed maximal size of response buffer.';
    }
    request.offset = this.pointer;
    request.length = size;
    this.pointer += size;

    log.info('Response Buffer allocate %d to request[%d],' +
      ' current size: %d, maximal size: %d', size, request.seq, this.pointer,
      dubboConfig.resBufferSize);
  },
  /**
   * 根据请求处理的参数读取对应的缓冲数据
   * @param request {Object}
   * @returns {Array.<T>|Blob|ArrayBuffer|Buffer|*|Array}
   */
  read(request) {
    return this.buffer.slice(request.offset, request.offset + request.length);
  },
  /**
   * 根据请求处理的参数写入对应的缓冲数据
   * @param buf {Buffer}
   * @param request {Object}
   */
  write(buf, request) {
    buf.copy(this.buffer, request.offset + request.length);
    this.pointer += buf.length;
    request.length += buf.length;
  },
  /**
   * 清除请求处理对应的缓冲
   * @param request
   */
  remove(request) {
    if (request.length === 0) {
      return;
    }
    var start = request.offset + request.length;
    this.buffer.copy(this.buffer, request.offset, start, this.pointer);
    this.pointer -= request.length;
  }
};

/**
 * 建立一条指定主机端口的dubbo连接
 * @param config {Object}
 * @param client {Client}
 * @returns {Socket}
 */
var createConnection = (config, client) => {
  var {port, host} = config;
  var socket = new net.Socket();
  client.socket = socket;
  socket.connect(port, host);
  socket
    .on('data', chunk => {
      var req,
        seq = getSequence(chunk);

      if (requests.has(seq)) {
        var length = getLength(chunk);
        req = requests.get(seq);
        // 如果需要粘包，则申请响应缓冲空间
        if (req.length === 0 && chunk.length < length) {
          try {
            ResBuffer.alloc(req, length);
          } catch (e) {
            requests.delete(req.seq);
            req.reject(e);  // 超出最大缓冲空间了
          }
        } else if (chunk.length >= req.length + length) {
          var resBuffer;
          try {
            resBuffer = Buffer.concat([ResBuffer.read(req), chunk]);
          } catch (ex) {
            log.error(ex.message);
            req.reject('Buffer concat error');
            removeRequest(req);
          }
          req.state = 4;
          req.resolve([resBuffer, req.seq]); // resolve
          removeRequest(req);
        } else {
          ResBuffer.write(chunk, req);
        }
      } else {
        log.warn('Not found request that handle the response, seq[%d]', seq);
      }
    })
    .on('end', () => {
      log.info('Dubbo connection closed.');
    })
    .on('error', err => {
      var count = 0;
      // 如果请求处理缓存中还有已发送但未成功接收的成员，则删除成员，并返回错误响应消息
      if (requests.size > 0) {
        for (var request of requests.values()) {
          if (request.state == 2) {
            request.reject('Request fail, because of dubbo connect error.');
            requests.delete(request.seq);
            count++;
          } else if (request.state == 3) {
            request.reject('Request fail, because of dubbo connect error.');
            removeRequest(request);
            count++;
          }
        }
      }
      log.warn('dubbo %s:%s connect error, due to %s. %d requests were affected.', err.address, err.port, err.errno, count);
      setTimeout(() => {
        if (client.retries++ < dubboConfig.retries) {
          socket.connect(port, host);
        } else {
          log.warn('Exceed maximal times on reconnect dubbo %s. Delete currnet connection', client.key);
          // 超出最大连接次数，就停止连接并删除该连接，如果陆续还有该连接的请求会重新建立的
          client.socket.removeAllListeners();
          client.socket = null;
          clients.delete(client.key);
        }
      }, dubboConfig.dubboReconnectDelay);
    })
    .on('drain', () => {
      log.warn('Socket drain, pls check requests those contain large data');
    })
    .on('connect', () => {
      log.info('Dubbo connected.')
    });
  log.info('Create a connection to dubbo %s:%d', host, port);
  return socket;
};

/**
 * 由于产生错误或者响应处理完毕，需要清除响应处理和响应缓冲
 * @param request {Request}
 */
var removeRequest = request => {
  requests.delete(request.seq);
  ResBuffer.remove(request);
};

/**
 * 发送请求数据
 * @param config
 * @param body {Buffer}
 * @returns Promise
 */
var sendRequest = (config, body) => new Promise((resolve, reject) => {
  var {host, port} = config,
    key = `${host}.${port}`,
    seq = sequence++,
    request;
  request = new Request(seq, resolve, reject, ResBuffer.pointer);
  requests.set(seq, request);
  // 建立连接对象
  if (!clients.has(key)) {
    var client = new Client(key, null);
    createConnection(config, client);
    clients.set(key, client);
  }
  var client = clients.get(key);
  var buf = addHead(body, seq);
  syncClientWrite(request, client, buf);
});

/**
 * socket在没有完全写入成功前，禁止其他请求数据写入，可以防止连包导致的响应丢包现象
 * @param request {Request}
 * @param client {Client}
 * @param buf
 */
var syncClientWrite = (request, client, buf) => {
  if (client.lock) {
    // 避免连包发送，换成请求数据
    client.queue.push(buf);
    request.state = 1;
    log.trace('Socket write to dubbo too busy, cache the buffer of request[%d].', request.seq);
  } else {
    client.lock = true;
    request.state = 2;
    client.socket.write(buf, () => {
      client.lock = false;
      request.state = 3;
      if (client.queue.length) {
        syncClientWrite(request, client, client.queue.shift());
      }
    });
  }
};

/**
 * 组成数据包头部
 * @param buf {Buffer}
 * @param seq {Integer}
 * @returns {Buffer}
 */
var addHead = (buf, seq) => {
  // 头部格式：4~11 8字节BE序列号，12~15 4字节BE包长度
  var head = new Buffer([0xda, 0xbb, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    i = 15,
    length = buf.length;

  writeSequence(head, seq);
  // 构造body长度信息
  if (length - 256 < 0) {
    head[i] = length - 256;
  } else {
    while (length - 256 > 0) {
      head[i--] = length % 256;
      length = length >> 8;
    }
    head[i] = length;
  }
  log.trace('Request head[%d]', seq, head);
  return Buffer.concat([head, buf]);
};

/**
 * 12到15描述了body的长度，需要额外累加head的长度
 * @param buf
 * @returns {Integer}
 */
var getLength = buf => 16 + buf[12] * 255 * 255 * 255
+ buf[13] * 255 * 255
+ buf[14] * 255
+ buf[15];

/**
 * 读取序列
 * 4到11组成8字节数字
 * @param buf
 * @returns {Integer}
 */
var getSequence = buf => {
  var high = buf.readUInt32BE(4);
  if (high > 0) {
    high *= 0x100000000;
  }
  return high + buf.readUInt32BE(8);
};

/**
 * 写序列
 * 4到11组成8字节数字
 * @param buf {Buffer}
 * @param seq {Integer}
 * @returns {Buffer}
 */
var writeSequence = (buf, seq) => {
  // seq = seq >= MAX_SEQUENCE
  //   ? 0 : seq + 1;
  var low = 0xffffffff;
  if (seq > low) {
    var high = parseInt(seq.toString(16).slice(0, 8), 16);
    buf.writeUInt32BE(high, 4);
  }
  buf.writeUInt32BE(seq & low, 8);
  return buf;
};

/**
 * 根据请求动态建立相应地址的dubbo长连接，并维护该连接，连接被存储到clients中
 * 处理请求，给请求添加头部数据，包括包长度（不含head长度）、唯一标识（自增序列号）
 * 请求被缓存到requests中，包括响应的处理函数（resolve, reject）
 * 不会为每个请求建立回调，而是通过响应序列号来确定相应的request响应处理函数
 *
 * @type {function(): Promise}
 */
exports.sendRequest = sendRequest;
