# 1. 总体定位

你的计算器工具建议不要只叫 `calculator`，而是设计成一个 **Computational Engine / Math Runtime / Scientific Calculator Tool**。

它应支持：

1. **自然语言到计算意图识别**
2. **表达式解析与安全求值**
3. **符号计算**
4. **数值计算**
5. **统计与概率**
6. **线性代数**
7. **优化与求解**
8. **单位与日期时间**
9. **金融计算**
10. **图论、几何、信号处理**
11. **绘图与可视化**
12. **批量计算与脚本模式**
13. **误差、异常、精度、单位维度检查**
14. **可解释步骤推导**
15. **结果格式化与导出**

建议工具内部拆成多个子模块，而不是一个巨大函数。

---

# 2. 推荐顶层目录结构

```text
calculator_tool/
├── core/                         # 核心运行时
│   ├── expression_parser/         # 表达式解析
│   ├── evaluator/                 # 安全求值器
│   ├── type_system/               # 数值/矩阵/单位/日期/分布等类型系统
│   ├── precision/                 # 精度、舍入、误差控制
│   ├── formatting/                # 结果格式化
│   ├── history/                   # 表达式历史、变量、自定义函数
│   └── errors/                    # 统一错误模型
│
├── arithmetic/                    # 基础算术与数论
├── algebra/                       # 代数、方程、多项式
├── symbolic/                      # 符号计算
├── complex/                       # 复数计算
├── linear_algebra/                # 线性代数
├── vector_geometry/               # 向量、几何、坐标
├── calculus/                      # 微积分、极限、级数、自动微分
├── numerical_methods/             # 数值方法
├── statistics/                    # 描述统计、统计检验
├── probability/                   # 概率分布与随机过程
├── optimization/                  # 优化、规划、约束求解
├── signal_processing/             # 傅里叶、卷积、滤波
├── differential_equations/        # ODE/PDE
├── finance/                       # 金融计算
├── units/                         # 单位换算、维度分析
├── datetime_calc/                 # 日期时间计算
├── discrete_math/                 # 集合、逻辑、图论、组合数学
├── data_tools/                    # 排序、去重、分箱、导入导出
├── plotting/                      # 函数图、统计图、3D、交互图
├── constants/                     # 数学/物理/化学/工程常数
├── ai_agent_interface/            # 给 Agent 调用的 schema 和路由
├── api/                           # REST / WebSocket / RPC
├── sandbox/                       # 安全执行环境
├── tests/                         # 单元测试、性质测试、数值对照测试
└── docs/                          # 文档、函数签名、示例、错误码
```

---

# 3. 能力目录设计

## A. 核心表达式与运行时能力

这是整个工具的地基，建议优先做扎实。

### A1. 表达式解析求值

包括你已有的：

* 表达式解析求值
* 变量定义
* 自定义函数
* 表达式历史记录
* 公式自动补全
* 错误提示
* 单位自动识别
* 结果格式化
* 小数 / 分数 / 科学计数法切换
* 角度制 / 弧度制切换
* 结果复制与导出
* 批量计算
* 脚本模式
* LaTeX 输入输出
* 代码生成：Python、JavaScript、LaTeX

建议补充：

* 隐式乘法解析：`2x`, `3(1+x)`, `sin x`
* 运算符优先级解析
* 函数嵌套解析
* 自定义变量作用域
* 临时变量与持久变量
* 常量别名识别：`pi`, `π`, `tau`, `e`, `φ`
* 数学函数别名：`ln`, `log`, `lg`, `sqrt`, `√`
* 中文表达式识别：`根号2`, `三分之一`, `百分之五`
* 混合表达式：`3 kg * 9.8 m/s^2`
* 复数表达式：`3 + 4i`
* 矩阵表达式：`[[1,2],[3,4]]^-1`
* 向量表达式：`dot([1,2,3],[4,5,6])`
* 分段函数表达式
* 参数化表达式
* 表达式安全沙箱
* 最大递归深度限制
* 超时控制
* 内存限制
* 大表达式性能保护

### A2. 类型系统

建议支持以下基础类型：

```text
Number
├── Integer
├── BigInteger
├── Rational
├── Float64
├── Decimal
├── BigFloat
├── Complex
└── Interval

Container
├── Vector
├── Matrix
├── Tensor
├── SparseMatrix
├── Polynomial
├── Set
├── Sequence
├── Distribution
├── TimeSeries
├── DataFrame
└── Graph

Domain
├── UnitValue
├── DateTime
├── Duration
├── CurrencyValue
├── GeometryObject
└── SymbolicExpression
```

建议每个计算函数都有统一输入输出：

```json
{
  "operation": "matrix.inverse",
  "input": {
    "matrix": [[1, 2], [3, 4]]
  },
  "options": {
    "precision": 50,
    "format": "decimal",
    "explain": true
  }
}
```

返回：

```json
{
  "ok": true,
  "result": [[-2, 1], [1.5, -0.5]],
  "type": "matrix",
  "metadata": {
    "method": "LU decomposition",
    "condition_number": 14.93,
    "precision": 50
  },
  "warnings": [],
  "steps": []
}
```

---

## B. 基础算术、数论与离散数学

你已有：

* 四则运算
* 乘方
* 开方
* 对数
* 指数
* 绝对值
* 取整
* 向上取整
* 向下取整
* 四舍五入
* 取余
* 取模
* 阶乘
* 双阶乘
* 排列数
* 组合数
* 最大公约数
* 最小公倍数
* 素数判定
* 质因数分解
* 进制转换
* 进制间任意转换
* 大整数运算
* 高精度浮点运算
* 科学计数法转换
* 有效数字舍入
* 误差传播计算
* 逻辑与或非异或
* 位运算
* 左移右移
* 集合交并差
* 对称差
* 子集判断
* 序列生成
* 连分数计算

建议补充：

### B1. 算术扩展

* 整除判断
* 商和余数同时返回
* 欧几里得除法
* 幂模运算
* 快速幂
* 模逆元
* 同余方程
* 中国剩余定理
* 扩展欧几里得算法
* Miller-Rabin 素性测试
* Pollard Rho 大整数分解
* 欧拉函数
* 莫比乌斯函数
* 约数个数
* 约数和
* 完全数判断
* 斐波那契数
* 卡特兰数
* 伯努利数
* 斯特林数
* 分拆数
* 整数分区
* 组合枚举
* 全排列生成
* 组合生成
* 笛卡尔积
* 幂集生成

### B2. 逻辑与集合

* 命题逻辑求值
* 真值表生成
* 逻辑表达式化简
* 德摩根变换
* 布尔代数化简
* 集合基数
* 集合划分
* 多重集合
* 关系判断：自反、对称、传递
* 等价关系闭包
* 偏序关系判断
* Hasse 图生成

### B3. 图论

你已有：

* 最短路径
* 最小生成树

建议补充：

* 图创建
* 邻接矩阵 / 邻接表转换
* BFS
* DFS
* 拓扑排序
* 连通分量
* 强连通分量
* Dijkstra
* Bellman-Ford
* Floyd-Warshall
* A* 搜索
* Kruskal
* Prim
* 最大流
* 最小割
* 二分图匹配
* 欧拉路径
* 哈密顿路径近似
* PageRank
* 中心性计算
* 社区发现基础算法

---

## C. 复数计算

你已有：

* 复数四则运算
* 复数指数对数
* 复数的模与辐角
* 复平面图

建议补充：

* 复数共轭
* 复数倒数
* 极坐标形式转换
* 指数形式转换
* 三角形式转换
* De Moivre 公式
* 复数开 n 次方
* 复数幂
* 主值 branch 选择
* 多值复对数
* 复三角函数
* 复双曲函数
* 复数矩阵
* 复数特征值
* 复变函数采样
* 复平面域着色图
* Mandelbrot / Julia 集基础绘制

关键点：
复数模块一定要明确 **分支问题**。例如 `log(-1)` 在复数域下不是唯一值，应返回主值，并在 metadata 中提示 branch。

---

## D. 线性代数与矩阵计算

你已有：

* 矩阵加减乘
* 矩阵转置
* 矩阵行列式
* 逆矩阵
* 伪逆
* 特征值与特征向量
* 奇异值分解
* 线性方程组求解
* 矩阵的秩
* 迹
* 范数
* 单位矩阵生成
* 随机矩阵生成
* 稀疏矩阵转换
* 线性代数条件数
* QR 分解
* LU 分解
* Cholesky 分解
* 符号矩阵运算
* 矩阵热力图

建议补充：

### D1. 基础矩阵操作

* 矩阵形状检查
* 矩阵拼接
* 矩阵切片
* 矩阵重塑
* 对角矩阵
* 上三角 / 下三角矩阵
* 对称矩阵判断
* 正定矩阵判断
* 半正定矩阵判断
* 正交矩阵判断
* 酉矩阵判断
* Hermitian 矩阵判断
* 稀疏矩阵存储格式：COO / CSR / CSC

### D2. 分解算法

除了已有的 QR / LU / Cholesky / SVD，建议增加：

* Eigen decomposition
* Schur decomposition
* Hessenberg decomposition
* Polar decomposition
* Jordan 标准形，符号模式下
* LDLᵀ 分解
* NMF 非负矩阵分解
* CUR 分解
* 随机 SVD
* 稀疏 SVD

### D3. 线性系统

* 精确求解
* 最小二乘解
* 欠定系统求解
* 超定系统求解
* 稀疏线性系统求解
* 共轭梯度法
* GMRES
* BiCGSTAB
* Jacobi 迭代
* Gauss-Seidel 迭代
* SOR 迭代
* 解的存在性判断
* 无解 / 多解说明
* 残差计算
* 条件数警告

### D4. 向量能力

你已有：

* 向量点积
* 向量叉积
* 向量范数
* 向量夹角
* 向量旋转
* 四元数运算
* 向量场图

建议补充：

* 向量投影
* 标准化
* 单位向量
* Gram-Schmidt 正交化
* 向量距离
* 余弦相似度
* 外积
* 张量积
* 混合积
* 三重积
* 向量基变换
* 坐标系转换
* 四元数转旋转矩阵
* 旋转矩阵转四元数
* 欧拉角转换
* SLERP 球面插值

---

## E. 初等函数、特殊函数与常数

你已有：

* 三角函数
* 反三角函数
* 双曲函数
* 反双曲函数
* 角度弧度转换
* 数学常数
* 物理常数查询
* 特殊函数值
* 伽马函数
* 贝塔函数
* 误差函数
* 贝塞尔函数

建议补充：

### E1. 初等函数

* `sin`, `cos`, `tan`
* `sec`, `csc`, `cot`
* `asin`, `acos`, `atan`, `atan2`
* `sinh`, `cosh`, `tanh`
* `asinh`, `acosh`, `atanh`
* `exp`, `expm1`
* `log`, `ln`, `log10`, `log2`, `log1p`
* `sqrt`, `cbrt`
* `hypot`
* `sigmoid`
* `softplus`
* `relu`
* `gelu`
* `erf`
* `erfc`

### E2. 特殊函数

* Gamma 函数
* Log-Gamma
* Beta 函数
* 不完全 Gamma
* 不完全 Beta
* Bessel J / Y / I / K
* Airy 函数
* Zeta 函数
* Hurwitz Zeta
* Dirichlet Eta
* 多伽马函数
* 椭圆积分
* 椭圆函数
* Lambert W 函数
* 超几何函数
* Legendre 多项式
* Hermite 多项式
* Laguerre 多项式
* Chebyshev 多项式
* 球谐函数

### E3. 常数库

* π
* e
* τ
* 黄金比例 φ
* Euler-Mascheroni 常数
* Catalan 常数
* Apéry 常数
* 光速
* 引力常数
* 普朗克常数
* 约化普朗克常数
* 电子电荷
* 玻尔兹曼常数
* 阿伏伽德罗常数
* 气体常数
* 真空介电常数
* 真空磁导率
* 标准重力加速度
* 电子质量
* 质子质量
* 中子质量
* 精细结构常数

---

## F. 代数、方程与符号计算

你已有：

* 多项式求值
* 多项式求根
* 符号微分
* 符号积分
* 符号化简
* 方程符号求解
* 多项式因式分解
* 有理式化简
* 三角恒等变换
* 递推式求解
* 偏导数
* 梯度
* 雅可比矩阵
* 黑塞矩阵
* 分段函数求值
* 方程求根
* 非线性方程组求解
* 极限数值逼近
* 级数求和

建议补充：

### F1. 多项式系统

* 多项式加减乘除
* 多项式长除法
* 多项式 GCD
* 多项式 LCM
* 多项式展开
* 多项式收集
* 多项式配方
* 多项式判别式
* Sturm 序列
* 根的重数
* 实根隔离
* 有理根定理
* Gröbner 基础
* 多元多项式求解

### F2. 符号化简

* 表达式展开
* 表达式因式分解
* 表达式合并同类项
* 幂指数化简
* 根式化简
* 对数化简
* 指数化简
* 三角化简
* 三角展开
* 三角合并
* 有理化分母
* 部分分式分解
* 符号假设系统：正数、整数、实数、非零等

### F3. 方程求解

* 一元一次方程
* 一元二次方程
* 高次多项式方程
* 超越方程数值解
* 方程组符号解
* 方程组数值解
* 不等式求解
* 绝对值方程
* 分段方程
* 参数方程
* 递推方程
* 差分方程
* 约束满足问题求解

### F4. 微积分符号能力

* 一阶导数
* 高阶导数
* 偏导数
* 方向导数
* 梯度
* 散度
* 旋度
* 拉普拉斯算子
* 雅可比矩阵
* 黑塞矩阵
* 不定积分
* 定积分
* 多重积分
* 线积分
* 面积分
* 极限
* 单侧极限
* 泰勒展开
* 洛朗展开
* 渐近展开
* 级数收敛性判断
* 傅里叶级数

---

## G. 微积分与数值方法

你已有：

* 数值积分
* 数值微分
* 方程求根
* 非线性方程组求解
* 插值
* 曲线拟合
* 傅里叶变换
* 快速傅里叶变换
* 卷积
* 相关运算
* 极限数值逼近
* 拉普拉斯变换数值计算
* 自动微分
* 区间运算

建议补充：

### G1. 数值微分

* 前向差分
* 后向差分
* 中心差分
* Richardson 外推
* 复步长微分
* 梯度数值估计
* 雅可比数值估计
* 黑塞数值估计
* 自动微分：forward mode
* 自动微分：reverse mode

### G2. 数值积分

* 梯形法
* Simpson 法
* Romberg 积分
* Gauss-Legendre 积分
* Gauss-Kronrod 积分
* 自适应积分
* 多重积分
* 蒙特卡洛积分
* 奇异积分处理
* 无穷区间积分
* 振荡积分

### G3. 求根与非线性方程

* 二分法
* 牛顿法
* 割线法
* Brent 法
* Muller 法
* Halley 法
* 多变量 Newton
* Broyden 方法
* Levenberg-Marquardt
* 收敛失败诊断
* 初值敏感性提示
* 多根搜索
* 区间根隔离

### G4. 插值与逼近

* 线性插值
* 多项式插值
* Lagrange 插值
* Newton 插值
* Hermite 插值
* 样条插值
* 三次样条
* B 样条
* RBF 插值
* 最近邻插值
* 分段线性插值
* Chebyshev 逼近
* Padé 逼近

### G5. 曲线拟合

你已有：

* 线性回归
* 多元线性回归
* 多项式拟合
* 指数拟合
* 对数拟合
* 幂律拟合

建议补充：

* 非线性最小二乘
* 鲁棒回归
* Ridge 回归
* Lasso 回归
* ElasticNet
* Logistic 回归
* 分段回归
* RANSAC
* Theil-Sen 回归
* 拟合优度 R²
* 调整 R²
* AIC / BIC
* 残差分析
* 置信带
* 预测区间

---

## H. 统计、概率与数据分析

你已有：

* 均值
* 中位数
* 众数
* 方差
* 标准差
* 极差
* 四分位数
* 百分位数
* 偏度
* 峰度
* 协方差
* 相关系数
* 求和
* 求积
* 累加和
* 累乘积
* 排序
* 去重
* 分箱
* 直方图数据
* 概率密度函数
* 累积分布函数
* 分位数函数
* 常见分布随机数生成
* 随机抽样
* 统计检验：t 检验、卡方检验、ANOVA、置信区间、假设检验
* 时间序列：ARIMA、季节分解、自相关 / 偏自相关
* 贝叶斯计算
* 聚类算法
* 主成分分析
* 奇异值检测

建议补充：

### H1. 描述统计

* 加权均值
* 几何均值
* 调和均值
* 截尾均值
* Winsorized mean
* 中位绝对偏差 MAD
* 标准误
* 变异系数
* 分位数摘要
* 箱线图数据
* 缺失值统计
* 异常值检测
* Z-score
* IQR 异常检测
* Robust Z-score

### H2. 概率分布

支持 PDF / PMF、CDF、PPF、随机数生成、矩估计、极大似然估计：

* Bernoulli
* Binomial
* Geometric
* Negative Binomial
* Hypergeometric
* Poisson
* Uniform
* Normal
* Lognormal
* Exponential
* Gamma
* Beta
* Chi-square
* Student t
* F 分布
* Weibull
* Pareto
* Cauchy
* Laplace
* Logistic
* Rayleigh
* Multinomial
* Dirichlet
* Multivariate Normal
* Wishart

### H3. 统计检验

除了已有的 t 检验、卡方、ANOVA，建议增加：

* 单样本 t 检验
* 双样本 t 检验
* 配对 t 检验
* Welch t 检验
* Z 检验
* F 检验
* 方差齐性检验
* Shapiro-Wilk 正态性检验
* Kolmogorov-Smirnov 检验
* Mann-Whitney U 检验
* Wilcoxon 符号秩检验
* Kruskal-Wallis 检验
* Friedman 检验
* Fisher 精确检验
* Pearson 相关显著性检验
* Spearman 相关
* Kendall tau
* 多重检验校正：Bonferroni、Benjamini-Hochberg

### H4. 贝叶斯计算

* 贝叶斯公式
* 共轭先验更新
* Beta-Binomial
* Gamma-Poisson
* Normal-Normal
* MAP 估计
* 后验均值
* 后验区间
* MCMC 基础采样
* Metropolis-Hastings
* Gibbs Sampling
* 贝叶斯线性回归
* 贝叶斯 A/B 测试

### H5. 时间序列

你已有：

* 移动平均
* 指数平滑
* ARIMA
* 季节分解
* 自相关 / 偏自相关

建议补充：

* 滚动统计
* 加权移动平均
* Holt-Winters
* SARIMA
* STL 分解
* 趋势检测
* 平稳性检验 ADF
* KPSS 检验
* 白噪声检验
* Ljung-Box 检验
* Granger 因果检验
* 缺失时间点补齐
* 重采样
* 时间窗口聚合
* 异常点检测
* 预测区间

### H6. 机器学习基础计算

你已有：

* 聚类算法
* PCA
* 奇异值检测

建议补充：

* K-means
* DBSCAN
* 层次聚类
* Gaussian Mixture
* PCA explained variance
* 标准化
* 归一化
* Min-Max scaling
* One-hot 编码
* 距离矩阵
* 余弦相似度矩阵
* KNN 查询
* 简单分类指标：accuracy、precision、recall、F1
* ROC AUC
* 混淆矩阵
* 交叉熵
* MSE / MAE / RMSE / MAPE

---

## I. 优化、规划与模拟

你已有：

* 线性规划
* 非线性规划
* 整数规划
* 梯度下降
* 模拟退火
* 蒙特卡洛模拟
* 随机游走模拟
* 约束满足问题求解
* 参数扫描

建议补充：

### I1. 连续优化

* 一维最小化
* 多维无约束优化
* 有约束优化
* 梯度下降
* 随机梯度下降
* 动量法
* Adam
* Newton 法
* BFGS
* L-BFGS
* Nelder-Mead
* Powell 方法
* 坐标下降
* Trust-region
* 罚函数法
* 拉格朗日乘子
* KKT 条件检查

### I2. 规划问题

* 线性规划 LP
* 二次规划 QP
* 非线性规划 NLP
* 整数规划 IP
* 混合整数规划 MILP
* 0-1 背包
* 运输问题
* 指派问题
* 最短路规划
* 资源分配
* 约束满足 CSP
* SAT / MaxSAT 接口
* 目标规划
* 多目标优化
* Pareto 前沿

### I3. 随机模拟

* 蒙特卡洛模拟
* Bootstrap
* Jackknife
* 随机游走
* 马尔可夫链模拟
* 排队系统模拟
* 泊松过程
* Brownian motion
* 几何布朗运动
* 重采样
* 拉丁超立方采样
* Sobol 序列
* 敏感性分析

---

## J. 几何、坐标与空间计算

你已有：

* 几何面积
* 几何体积
* 三角函数解三角形
* 多边形面积
* 凸包计算
* 距离计算
* 坐标变换
* 坐标旋转
* 向量旋转
* 参数方程绘图
* 极坐标绘图
* 3D 曲面图

建议补充：

### J1. 平面几何

* 点到点距离
* 点到线距离
* 点到线段距离
* 两线夹角
* 两线交点
* 线段相交判断
* 圆面积
* 圆周长
* 扇形面积
* 椭圆面积
* 三角形面积
* 海伦公式
* 三角形外接圆 / 内切圆
* 多边形面积 Shoelace
* 多边形周长
* 点在多边形内判断
* 凸包
* 最小外接矩形
* 最小外接圆
* Voronoi 图
* Delaunay 三角剖分

### J2. 立体几何

* 球体体积 / 表面积
* 圆柱体体积 / 表面积
* 圆锥体体积 / 表面积
* 棱柱
* 棱锥
* 椭球体
* 圆环体
* 点到平面距离
* 线面交点
* 平面方程
* 三维旋转
* 三维坐标变换
* 齐次坐标
* 仿射变换
* 投影变换

### J3. 地理坐标

建议增加：

* 经纬度距离 Haversine
* 球面距离
* 方位角计算
* 经纬度偏移
* WGS84 基础计算
* UTM 坐标转换
* 地图投影基础转换

---

## K. 单位、维度与日期时间

你已有：

* 单位换算
* 单位维度检查系统
* 日期时间差值
* 日期加减运算
* 工作日计算
* 时间戳转换
* 闰年判断

建议补充：

### K1. 单位系统

支持类别：

* 长度
* 面积
* 体积
* 质量
* 时间
* 速度
* 加速度
* 力
* 压力
* 能量
* 功率
* 温度
* 电流
* 电压
* 电阻
* 电荷
* 频率
* 信息单位：bit、byte、KB、KiB
* 角度
* 光照
* 流量
* 浓度
* 密度
* 油耗
* 货币，建议外部实时汇率，不建议内置静态值
* 食品营养单位：cal、kcal、J
* 工程单位：psi、bar、atm、hp、BTU

重点能力：

* 单位自动识别
* 单位维度检查
* 复合单位解析：`kg*m/s^2`
* 单位约简
* SI 前缀
* 英制 / 公制转换
* 温度特殊转换
* 单位表达式计算
* 物理公式维度验证

### K2. 日期时间

* 日期差值
* 时间差值
* 日期加减
* 工作日计算
* 节假日日历，按国家/地区
* ISO week
* 月末判断
* 季度计算
* 财年计算
* 时区转换
* Unix timestamp
* 毫秒时间戳
* 日期格式解析
* 自然语言日期解析：明天、下周五、三个月后
* 年龄计算
* 倒计时
* 重复规则 RRULE 解析
* 日程冲突检测

---

## L. 金融计算

你已有：

* 净现值
* 内部收益率
* 贷款分期计算
* 债券定价
* 期权定价
* 财务折旧计算

建议补充：

### L1. 基础金融

* 单利
* 复利
* 年化收益率
* 等额本息
* 等额本金
* 月供计算
* 提前还款计算
* 现值 PV
* 终值 FV
* 年金
* 永续年金
* NPV
* IRR
* MIRR
* Payback Period
* Discounted Payback Period
* ROI
* ROE
* ROA
* CAGR

### L2. 债券

* 债券现值
* 到期收益率 YTM
* 当前收益率
* 久期
* 修正久期
* 凸性
* 零息债券
* 息票债券
* 债券价格-利率敏感性

### L3. 期权与衍生品

* Black-Scholes 期权定价
* 看涨 / 看跌期权
* Put-call parity
* Greeks：Delta、Gamma、Theta、Vega、Rho
* 二叉树期权定价
* 蒙特卡洛期权定价
* 隐含波动率求解

### L4. 折旧与会计

* 直线折旧
* 双倍余额递减
* 年数总和法
* 产量法
* 摊销表
* 税后现金流
* 盈亏平衡点

---

## M. 信号处理、变换与图像基础

你已有：

* 傅里叶变换
* 快速傅里叶变换
* 卷积
* 相关运算
* 霍夫变换

建议补充：

### M1. 信号处理

* DFT
* FFT
* IFFT
* STFT
* 窗函数：Hann、Hamming、Blackman
* 功率谱密度
* 频谱峰值检测
* 低通滤波
* 高通滤波
* 带通滤波
* 带阻滤波
* FIR 滤波
* IIR 滤波
* 移动平均滤波
* Savitzky-Golay 滤波
* 卷积
* 互相关
* 自相关
* 去趋势
* 重采样
* 插值重采样

### M2. 图像计算基础

* 灰度转换
* RGB 与十六进制颜色转换
* HSV / RGB 转换
* HSL / RGB 转换
* 图像直方图
* 阈值分割
* 边缘检测
* Sobel
* Canny
* Hough line
* Hough circle
* 形态学腐蚀 / 膨胀
* 开运算 / 闭运算
* 连通域分析
* 图像卷积核计算

---

## N. 微分方程与科学计算

你已有：

* 一阶常微分方程数值解
* 二阶常微分方程数值解
* 偏微分方程简单数值解
* 拉普拉斯变换数值计算

建议补充：

### N1. ODE

* Euler 方法
* 改进 Euler
* Runge-Kutta 2
* Runge-Kutta 4
* 自适应 RK45
* Adams-Bashforth
* Adams-Moulton
* BDF
* 刚性方程检测
* 初值问题 IVP
* 边值问题 BVP
* 事件检测
* 相图
* 稳定点分析

### N2. PDE

* 有限差分
* 热方程
* 波动方程
* 拉普拉斯方程
* 泊松方程
* 边界条件处理
* 显式格式
* 隐式格式
* Crank-Nicolson
* 简单有限元接口

### N3. 变换

* Laplace transform
* Inverse Laplace transform
* Fourier transform
* Inverse Fourier transform
* Z-transform
* Wavelet transform 基础
* 数值反变换
* 卷积定理应用

---

## O. 可视化与图表

你已有：

* 函数绘图
* 参数方程绘图
* 极坐标绘图
* 统计图表
* 3D 曲面图
* 向量场图
* 复平面图
* 矩阵热力图
* 交互式图表

建议补充：

### O1. 数学图

* 单变量函数图
* 多函数对比图
* 隐函数图
* 分段函数图
* 参数方程图
* 极坐标图
* 复平面图
* 向量场图
* 等高线图
* 曲率图
* 梯度场图
* 相图
* 方向场

### O2. 统计图

* 直方图
* 箱线图
* 小提琴图
* 散点图
* 折线图
* 柱状图
* 面积图
* 饼图，不建议默认使用
* QQ 图
* 残差图
* 相关矩阵热力图
* 分布曲线图
* ECDF 图
* 时间序列图

### O3. 三维图

* 3D 曲线
* 3D 曲面
* 3D 散点
* 3D 向量场
* 等值面
* 参数曲面
* 旋转体可视化

### O4. 导出

* PNG
* SVG
* PDF
* HTML
* JSON 图表配置
* Vega-Lite
* Plotly JSON
* Mermaid
* LaTeX TikZ，进阶

---

# 4. AI Agent 工具接口设计

建议不要让 Agent 直接调用大量函数，而是设计三层接口。

## 第一层：智能路由接口

```json
{
  "tool": "compute",
  "query": "求矩阵 [[1,2],[3,4]] 的逆矩阵，并给出步骤",
  "options": {
    "explain": true,
    "precision": 30,
    "format": "fraction"
  }
}
```

适合 Agent 使用，自然语言输入，内部判断调用哪个模块。

## 第二层：结构化操作接口

```json
{
  "tool": "math.linear_algebra.inverse",
  "args": {
    "matrix": [[1, 2], [3, 4]]
  },
  "options": {
    "method": "auto",
    "precision": 50,
    "explain": true
  }
}
```

适合可靠工具调用。

## 第三层：低级函数接口

```ts
inverse(matrix: Matrix, options?: InverseOptions): MatrixResult
```

适合内部 SDK 调用。

---

# 5. 推荐 Tool Schema

## 通用请求格式

```json
{
  "operation": "string",
  "input": {},
  "options": {
    "precision": 50,
    "numeric_backend": "auto",
    "symbolic": false,
    "explain": false,
    "format": "auto",
    "angle_unit": "radian",
    "timeout_ms": 3000,
    "max_memory_mb": 256
  }
}
```

## 通用响应格式

```json
{
  "ok": true,
  "result": {},
  "result_type": "number | matrix | vector | expression | plot | table | error",
  "formatted": "string",
  "latex": "string",
  "steps": [],
  "warnings": [],
  "metadata": {
    "method": "string",
    "precision": 50,
    "elapsed_ms": 12,
    "backend": "string"
  }
}
```

## 错误响应格式

```json
{
  "ok": false,
  "error": {
    "code": "SINGULAR_MATRIX",
    "message": "矩阵不可逆，因为行列式为 0。",
    "suggestion": "可以尝试使用伪逆 pinv(matrix)。"
  },
  "warnings": [],
  "metadata": {
    "elapsed_ms": 8
  }
}
```

---

# 6. 错误与异常体系

你已经列了：

* 处理精度误差
* 溢出 / 下溢
* 奇异矩阵
* 病态矩阵
* 无解 / 多解
* 收敛失败
* 复数分支问题
* 分布参数非法
* 单位维度不匹配
* 大规模数据性能

建议统一错误码：

```text
PARSE_ERROR
UNSUPPORTED_OPERATION
INVALID_ARGUMENT
DOMAIN_ERROR
DIVISION_BY_ZERO
OVERFLOW
UNDERFLOW
PRECISION_LOSS
NON_CONVERGENCE
MAX_ITERATION_REACHED
SINGULAR_MATRIX
ILL_CONDITIONED_MATRIX
DIMENSION_MISMATCH
UNIT_DIMENSION_MISMATCH
NO_SOLUTION
MULTIPLE_SOLUTIONS
COMPLEX_BRANCH_AMBIGUITY
INVALID_DISTRIBUTION_PARAMETER
RANDOM_SEED_ERROR
TIMEOUT
MEMORY_LIMIT_EXCEEDED
UNSAFE_EXPRESSION
NUMERIC_BACKEND_ERROR
SYMBOLIC_BACKEND_ERROR
PLOT_RENDER_ERROR
DATA_IMPORT_ERROR
```

每个错误都应该包含：

1. 错误码
2. 人类可读解释
3. 可能原因
4. 修复建议
5. 是否可以 fallback
6. 是否可以近似计算

---

# 7. 精度策略

这是“快准强大”的关键。

## 推荐精度层级

```text
fast_float       # 默认快速计算，float64
decimal          # 财务、高精度小数
rational         # 精确分数
bigint           # 大整数
bigfloat         # 任意精度浮点
interval         # 区间计算，误差边界
symbolic         # 符号精确
auto             # 自动选择
```

## 自动选择建议

| 场景         | 推荐精度                         |
| ---------- | ---------------------------- |
| 普通四则运算     | float64 / rational           |
| 财务计算       | decimal                      |
| 大整数阶乘、组合数  | bigint                       |
| 矩阵数值计算     | float64，必要时 high precision   |
| 符号化简       | symbolic                     |
| 误差边界敏感     | interval                     |
| 单位计算       | UnitValue + Decimal          |
| 科学计算       | float64 / bigfloat           |
| Agent 解释步骤 | symbolic 优先，numeric fallback |

## 结果显示策略

同一个结果可以同时返回：

```json
{
  "exact": "1/3",
  "decimal": "0.33333333333333333333",
  "scientific": "3.3333333333333333333e-1",
  "latex": "\\frac{1}{3}"
}
```

---

# 8. 技术栈建议

## 方案一：Python-first，最强科学计算生态

适合你想最快做出强大的 Agent 工具。

### 后端语言

* Python 3.11+
* FastAPI
* Pydantic
* Uvicorn / Gunicorn

### 数学核心库

```text
sympy          # 符号计算
numpy          # 数值数组
scipy          # 科学计算、优化、积分、线代、统计
mpmath         # 任意精度浮点和特殊函数
decimal        # 财务小数
fractions      # 有理数
statistics     # 基础统计
math           # 基础数学
cmath          # 复数
```

### 数据分析

```text
pandas
polars
pyarrow
openpyxl
```

### 统计与机器学习

```text
scipy.stats
statsmodels
scikit-learn
```

### 优化与规划

```text
scipy.optimize
cvxpy
pulp
ortools
z3-solver
```

### 图论

```text
networkx
igraph
```

### 单位

```text
pint
unyt
```

### 日期时间

```text
python-dateutil
pytz / zoneinfo
holidays
workalendar
```

### 金融

```text
numpy-financial
QuantLib，复杂债券和衍生品可选
```

### 绘图

```text
matplotlib
plotly
bokeh
altair
```

### API 与服务

```text
FastAPI
Pydantic
Redis
Celery / RQ
Docker
```

### 优点

* 实现速度快
* 科学计算库成熟
* Agent 调用方便
* 符号和数值能力都强

### 缺点

* 极致性能不如 C++ / Rust
* 沙箱隔离需要认真做
* 大规模矩阵和高并发要优化

---

## 方案二：TypeScript-first，适合前端和在线计算器

### 核心技术

```text
TypeScript
Node.js
mathjs
decimal.js
big.js
fraction.js
complex.js
ml-matrix
simple-statistics
date-fns
luxon
d3
plotly.js
```

### 优点

* 前后端共享代码
* Web 集成好
* UI 交互方便
* 部署简单

### 缺点

* 符号计算弱于 Python
* 高级科学计算生态不如 Python
* 大规模数值计算较弱

---

## 方案三：混合架构，推荐最终形态

```text
Agent
  ↓
TypeScript API Gateway
  ↓
Python Scientific Runtime
  ↓
Rust / C++ 高性能内核，可选
```

### 推荐结构

```text
frontend:      React / Next.js
agent layer:   TypeScript
api gateway:   Node.js / FastAPI
math runtime:  Python
perf kernel:   Rust / C++ / WASM
storage:       PostgreSQL + Redis
sandbox:       Docker / Firecracker
queue:         Celery / Redis Queue
```

### 为什么推荐混合架构

* Python 负责强大的数学能力
* TypeScript 负责 Agent 工具调用、Web、UI、Schema
* Rust / C++ 负责高性能热点
* WASM 负责浏览器端轻量计算
* 后端沙箱负责复杂和危险计算

---

# 9. Agent 调用设计建议

你的 Agent 不应该只有一个 `calculator(expression)`。

建议至少有这些工具：

```text
calculator.evaluate
calculator.solve
calculator.simplify
calculator.plot
calculator.stats
calculator.linalg
calculator.optimize
calculator.units
calculator.datetime
calculator.finance
calculator.explain
calculator.convert
calculator.batch
calculator.script
```

但对外可以封装成一个统一入口：

```json
{
  "name": "calculator",
  "description": "用于数学、科学、统计、金融、单位、日期、符号、矩阵、绘图等计算。",
  "input_schema": {
    "query": "用户自然语言或表达式",
    "mode": "auto | numeric | symbolic | plot | stats | units | finance | linalg",
    "precision": "auto | float64 | decimal | rational | bigfloat",
    "explain": "boolean",
    "output_format": "auto | decimal | fraction | latex | json | table | chart"
  }
}
```

内部路由：

```text
query
 ↓
意图识别
 ↓
表达式解析
 ↓
类型推断
 ↓
选择后端
 ↓
计算
 ↓
校验
 ↓
格式化
 ↓
返回结果 + 解释 + 警告
```

---

# 10. 计算后端选择策略

建议实现一个 backend router。

```text
simple arithmetic        → Python math / Decimal / Fraction
big integer              → Python int / gmpy2
symbolic                 → SymPy
high precision           → mpmath
matrix small/medium      → NumPy / SciPy
matrix symbolic          → SymPy Matrix
sparse matrix            → scipy.sparse
optimization             → scipy.optimize / cvxpy / ortools
statistics               → scipy.stats / statsmodels
machine learning         → scikit-learn
units                    → pint
finance                  → numpy-financial / QuantLib
graph                    → networkx
plot                     → plotly / matplotlib
```

---

# 11. 安全设计

这是 AI Agent 工具非常重要的一层。

## 必须防止

* 任意代码执行
* 文件系统访问
* 网络访问
* 无限循环
* 超大内存申请
* 超大矩阵计算
* 递归爆炸
* 符号化简卡死
* 表达式炸弹，例如巨大阶乘、巨大幂塔
* 恶意导入模块
* shell 注入
* pickle 反序列化

## 建议措施

```text
1. 自己写表达式 AST，不直接 eval
2. 白名单函数注册
3. 限制 AST 节点数量
4. 限制最大矩阵大小
5. 限制最大整数位数
6. 限制最大精度
7. 限制递归深度
8. 限制运行时间
9. 限制内存
10. 每个任务放入沙箱
11. 禁止文件和网络访问
12. 支持取消任务
13. 记录慢查询
14. 对大任务返回估算和确认
```

---

# 12. 性能设计

## 快

* 常用表达式走轻量 evaluator
* 小矩阵直接 NumPy
* 大矩阵自动切 sparse
* 高精度只在需要时启用
* 符号计算设置 timeout
* 常量、单位、分布对象缓存
* 常见函数 JIT 或向量化
* 批量计算走矢量化
* 图表延迟渲染
* 长任务异步队列

## 准

* 小整数和分数优先 exact
* 财务使用 Decimal，不用 float
* 矩阵返回条件数
* 求根返回残差
* 优化返回收敛状态
* 统计检验返回假设说明
* 单位计算做维度检查
* 概率分布做参数合法性检查
* 符号和数值双重校验关键结果

## 强大

* 支持自然语言
* 支持表达式
* 支持结构化 JSON
* 支持符号 + 数值 + 图表
* 支持批处理
* 支持脚本模式
* 支持导出
* 支持解释步骤
* 支持 fallback
* 支持错误建议

---

# 13. 推荐优先级路线图

## P0：最小可用但可靠

必须先做：

* 四则运算
* 乘方、开方、指数、对数
* 三角函数
* 取整、取余、绝对值
* 分数、小数、科学计数法
* 大整数
* 变量定义
* 表达式解析
* 安全求值
* 基础单位换算
* 基础日期时间
* 错误提示
* JSON 输入输出
* 计算历史
* 精度控制

## P1：科学计算核心

* 复数
* 向量
* 矩阵
* 线性方程组
* 行列式、逆、秩、特征值、SVD
* 描述统计
* 概率分布
* 数值积分
* 数值微分
* 方程求根
* 曲线拟合
* 函数绘图

## P2：符号与高级数学

* 符号化简
* 符号微分
* 符号积分
* 方程符号求解
* 多项式运算
* 极限
* 级数
* 三角恒等变换
* 符号矩阵
* 公式步骤推导

## P3：工程与应用

* 优化
* 线性规划
* 整数规划
* ODE / PDE
* 信号处理
* 金融计算
* 统计检验
* 时间序列
* 聚类
* PCA
* 图论
* 几何
* 交互式图表

## P4：Agent 高级能力

* 自然语言计算意图解析
* 自动选择计算后端
* 自动纠错
* 公式补全
* 单位自动识别
* 结果解释
* 多步骤推导
* 批量任务
* 代码生成
* 数据导入导出
* 任务缓存
* 性能诊断
* 用户偏好记忆

---

# 14. 函数命名规范

建议用命名空间风格：

```text
arithmetic.add
arithmetic.pow
number.factorial
number.gcd
number.prime_factorization

complex.abs
complex.arg
complex.exp
complex.log

linalg.matmul
linalg.det
linalg.inv
linalg.pinv
linalg.solve
linalg.eig
linalg.svd
linalg.rank
linalg.norm

stats.mean
stats.variance
stats.correlation
stats.ttest
stats.anova

probability.normal.pdf
probability.normal.cdf
probability.normal.ppf
probability.normal.sample

calculus.diff
calculus.integrate
calculus.limit
calculus.series

symbolic.simplify
symbolic.factor
symbolic.solve
symbolic.expand

units.convert
units.check_dimension
datetime.diff
finance.npv
finance.irr
plot.function
```

好处：

* 易扩展
* Agent 更容易调用
* 文档清晰
* 错误定位方便

---

# 15. 示例：Agent 计算器工具描述

可以这样写工具描述：

```text
这是一个通用计算工具，支持基础算术、数论、复数、矩阵、线性代数、微积分、符号计算、统计、概率、优化、单位换算、日期时间、金融、几何、图论、信号处理、绘图和批量计算。

当用户请求精确数学结果、数值近似、公式推导、单位换算、统计分析、矩阵计算、方程求解、函数绘图、金融计算或日期时间计算时，应调用此工具。

工具可以返回数值结果、精确分数、LaTeX、计算步骤、图表数据、错误解释和修复建议。
```

---

# 16. 建议最终能力目录总览

你可以把整个工具归为 24 个一级目录：

```text
1. 核心表达式与运行时
2. 基础算术
3. 数论与组合数学
4. 逻辑、集合与离散数学
5. 复数
6. 向量与几何
7. 线性代数
8. 初等函数
9. 特殊函数与常数
10. 符号代数
11. 方程与不等式
12. 微积分
13. 数值方法
14. 概率分布
15. 统计分析
16. 时间序列
17. 优化与规划
18. 随机模拟
19. 单位与维度
20. 日期时间
21. 金融计算
22. 信号与图像基础
23. 图论与网络
24. 绘图、导出与 Agent 交互
```

---

# 17. 最推荐的 MVP 技术方案

如果你现在要动手做，我建议：

```text
语言：Python + TypeScript
后端：FastAPI
Schema：Pydantic
表达式解析：Lark / ANTLR / 自研 Pratt Parser
符号计算：SymPy
数值计算：NumPy + SciPy
高精度：mpmath + decimal + fractions
单位：pint
统计：scipy.stats + statsmodels
优化：scipy.optimize + cvxpy + ortools
图论：networkx
绘图：Plotly + Matplotlib
数据：pandas + polars
任务队列：Celery + Redis
缓存：Redis
持久化：PostgreSQL
容器：Docker
安全沙箱：Docker 限制资源，后续可升级 Firecracker
前端：Next.js + React + Monaco Editor + Plotly.js
Agent 接口：JSON Schema / OpenAPI / MCP Tool
测试：pytest + hypothesis
```

---

# 18. 最重要的工程建议

不要一开始就把所有功能塞进一个 `calculate()`。

正确做法是：

```text
统一入口 + 多后端 + 类型系统 + 安全表达式 AST + 明确错误模型
```

也就是：

```text
用户输入
  ↓
解析器
  ↓
类型推断
  ↓
能力路由
  ↓
计算后端
  ↓
结果校验
  ↓
格式化输出
  ↓
解释 / 图表 / 错误建议
```

这样你的工具才能真正做到：

```text
快：简单计算不走重型后端
准：精度和类型自动选择
强：复杂任务可以调用符号、数值、统计、优化、绘图等后端
稳：所有异常都有明确错误码和 fallback
适合 Agent：输入输出结构化，可解释，可追踪
```
