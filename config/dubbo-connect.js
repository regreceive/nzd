/**
 * 为dubbo-connect提供配置
 * @type {{resBufferSize: number, dubboReconnectDelay: number, retries: number}}
 */
module.exports = {
  resBufferSize: 1024 * 1024,  // 响应区缓冲空间大小
  dubboReconnectDelay: 3000,  // 失败重连间隔
  retries: 10 // 失败后连接次数
}
