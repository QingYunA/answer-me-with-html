// Characters that are written in only one form, for telling Traditional Chinese from Simplified in a draft that does not say.
// Each pair is one character in its Simplified form and in its Traditional form. Only pairs where neither form is the other's
// common spelling are listed: a character both forms use (`的`, `人`) says nothing, and a character with several Traditional
// forms (`发`, `后`, `干`) is left out.
const PAIRS = '这這 个個 们們 说說 国國 为為 来來 时時 会會 过過 对對 学學 还還 没沒 样樣 开開 门門 问問 间間 点點 现現 种種 经經 动動 实實 机機 关關 业業 与與 无無 电電 书書 马馬 车車 见見 买買 卖賣 读讀 语語 话話 请請 让讓 认認 应應 当當 总總 将將 体體 华華 声聲 听聽 观觀 觉覺 记記 设設 计計 论論 议議 许許 证證 识識 调調 试試 该該 详詳 误誤 谈談 谢謝 谁誰 课課 负負 责責 贵貴 资資 费費 赛賽 财財 购購 货貨 贸貿 质質 钱錢 银銀 铁鐵 网網 页頁 级級 线線 类類 数數 据據 库庫 户戶 务務 区區 东東 乐樂 产產 亲親 儿兒 办辦 兴興 军軍 农農 况況 刘劉 创創 剧劇 单單 双雙 号號 员員 园園 围圍 图圖 圆圓 场場 块塊 坏壞 处處 备備 头頭 夹夾 奋奮 妇婦 孙孫 宁寧 宝寶 审審 层層 属屬 岁歲 师師 带帶 帮幫 广廣 异異 张張 强強 录錄 归歸 彻徹 径徑 悬懸 惊驚 战戰 护護 报報 择擇 担擔 拥擁 拟擬 换換 损損 敌敵 断斷 旧舊 显顯 晓曉 暂暫 术術 杂雜 极極 构構 标標 栏欄 树樹 档檔 桥橋 检檢 楼樓 欢歡 毕畢 气氣 汉漢 济濟 浏瀏 测測 湾灣 满滿 灭滅 灯燈 爱愛 状狀 独獨 环環 画畫 疗療 盘盤 码碼 确確 离離 积積 称稱 穷窮 竞競 笔筆 简簡 粮糧 紧緊 红紅 约約 纪紀 纯純 纸紙 组組 细細 织織 终終 结結 给給 络絡 统統 继繼 续續 维維 综綜 绿綠 缓緩 编編 罗羅 习習 联聯 职職 脑腦 脸臉 节節 营營 蓝藍 虑慮 虽雖 补補 装裝 览覽 规規 视視 触觸 订訂 讨討 训訓 讲講 访訪 评評 词詞 译譯 诉訴 输輸 辑輯 边邊 达達 迁遷 运運 远遠 连連 进進 选選 递遞 适適 逻邏 遗遺 邮郵 铺鋪 链鏈 销銷 锁鎖 错錯 键鍵 镜鏡 长長 闪閃 闭閉 闻聞 阅閱 队隊 阶階 际際 隐隱 难難 静靜 顶頂 项項 顺順 须須 题題 额額 风風 飞飛 饭飯 馆館 验驗 骗騙 鱼魚 鸟鳥 鸡雞 麦麥 齐齊 齿齒 龙龍'.split(' ');

export const SIMPLIFIED_ONLY = PAIRS.map((pair) => [...pair][0]).join('');
export const TRADITIONAL_ONLY = PAIRS.map((pair) => [...pair][1]).join('');
