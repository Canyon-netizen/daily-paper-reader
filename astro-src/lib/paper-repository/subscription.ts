// /lib/paper-repository/subscription.ts — 仓库变更订阅 / 通知模型。
//
// 解决的问题:
//   - 调用方(论文页 / 日历 / 库页)在 SSR 期间创建仓库实例并消费缓存;
//   - 部分场景(主题搜改类目、设置页推 Gist 后回拉数据)需要"使缓存失效并广播"。
//   - 没有这层抽象时,仓库内部只能默默重读;UI 层不知道"什么时候要拉新",
//     会复用老 cache 直到 60s TTL 自然过期,体感是 UI 滞后。
//
// 设计:
//   - subscribe(reason, handler) 在指定 reason(字符串)的事件触发时回调;
//   - reason 是个轻量分类标签(如 'settings-saved' / 'topic-updated'),
//     让 caller 自定义。
//   - notification 总是顺手 invalidate() 仓库缓存(强制下次 list() 重读),
//     caller 的 onChange 后续可直接 repo.list() 拿到新鲜数据。

export type RepositoryChangeReason = string;

/** 订阅一个变更 reason;handler 在该 reason 触发时被调用。 */
export type Subscriber = (reason: RepositoryChangeReason) => void;

/** 一个 subscriber group,挂在仓库实例上;允许 add / remove / fire。 */
export class SubscriberRegistry {
  private readonly subs = new Set<Subscriber>();

  add(handler: Subscriber): () => void {
    this.subs.add(handler);
    return () => this.subs.delete(handler);
  }

  remove(handler: Subscriber): void {
    this.subs.delete(handler);
  }

  fire(reason: RepositoryChangeReason): void {
    // 顺序遍历;handler 内部 add/remove 自身会同步修改 this.subs,
    // 但 Set 迭代语义安全(每次 next() 拿到下一项)。
    for (const h of this.subs) {
      try {
        h(reason);
      } catch (e) {
        console.warn('[paper-repository] subscriber threw:', e);
      }
    }
  }

  size(): number {
    return this.subs.size;
  }
}