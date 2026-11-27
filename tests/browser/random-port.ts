// 专属随机端口：在动态端口区间内取值，配合 strictPort 保证不与其它进程冲突。
export function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}
