---
title: Kubernetes 是怎么发展起来的
subtitle: 从 Google 内部的集群管理器，到运行容器的默认方式
cols: 3
---
## A 时间线 {span=3}
```timeline h
2003 | Google 内部的 Borg | 承载 Google 绝大部分任务
2013 | Docker 发布 | 容器变得容易构建
*2014 | Kubernetes 发布 | 开源，用 Go 编写
2015 | v1.0 与 CNCF | Google 把项目交给基金会
2018 | CNCF 首个毕业项目 | 项目进入稳定期
2022 | v1.24 移除 dockershim | 任意 CRI 运行时都能用
```

## B 从 Borg 继承的设计 {span=2}
| Borg 里的设计 | Kubernetes 里的对应 |
|---|---|
| 用标签给任务分组 | Label 和 Selector |
| 部署在一起的一组任务 | Pod |
| 每组任务一个 IP | 每个 Pod 一个 IP |
| 集中的状态存储 | etcd |

## C 为什么能普及
- 各大云厂商都提供托管服务。
- 笔记本和数据中心上的 API 完全一样。
- 扩展和核心用同一套 API。
