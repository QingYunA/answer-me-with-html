---
title: How Kubernetes came about
subtitle: From Google's internal cluster manager to the default way to run containers
cols: 3
---
## A Timeline {span=3}
```timeline h
2003 | Borg at Google | runs most of Google's jobs
2013 | Docker is released | containers get easy to build
*2014 | Kubernetes is announced | open source, written in Go
2015 | v1.0 and the CNCF | Google gives the project to a foundation
2018 | First CNCF graduate | the project is stable
2022 | dockershim removed in v1.24 | any CRI runtime works
```

## B What came from Borg {span=2}
| Idea in Borg | In Kubernetes |
|---|---|
| Jobs grouped by labels | Labels and selectors |
| A unit of co-located tasks | The Pod |
| One IP address per task group | One IP address per Pod |
| A central state store | etcd |

## C Why it spread
- Every big cloud offers it as a managed service.
- The API is the same on a laptop and in a data center.
- Extensions use the same API as the core.
