var dubboService = require('./dubbo-service');
var java = require('js-to-java');
var config = require('./../../config/micro-service');
const log = require('./../../logs/index').logger("index");

/*
 启动zookeeper服务，启动dubbo并注册相关服务
 zookeeper-children创建并维护与zookeeper的长连接，解析注册的服务
 dubbo-connect创建并维护与dubbo(可能多个)的长连接，缓存请求和响应包
 dubbo-service可以直接调用的，用于转换请求数据为hessian格式，并转换响应数据为json格式
 */

var method = "checkUnique";
var arg1 = java('Map', {dicCode: 'CM_ADDRSEC'});
var args = [arg1];

console.time('mine')
var ds = dubboService(
  Object.assign(config, {path: 'com.petrochina.gss.gs.sys.api.IGssDicService'})
);
ds.execute(method, args).then(data => {
  console.timeEnd('mine')
  //console.log(data);

  /* 回调后再次请求 */
  console.time('mine1')
  ds.execute(method, args).then(data => {
    console.timeEnd('mine1')
    // console.log(data);
  }).catch(err => {
    console.log(err);
  });

  /* 并发请求 */

  // console.time('mine2')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine2')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine3')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine3')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine4')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine4')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine5')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine5')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine6')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine6')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine7')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine7')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine8')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine8')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine9')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine9')
  // }).catch(err => {
  //   console.log(err);
  // });
  //
  // console.time('mine10')
  // ds.execute('getSysDict', [java.int(1)]).then(data => {
  //   console.timeEnd('mine10')
  // }).catch(err => {
  //   console.log(err);
  // });

}).catch(err => {
  console.log(err);
});

