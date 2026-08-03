---
title: The unique value of zero prediction errors in reinforcement learning
title_zh: 零预测误差在强化学习中的独特价值
authors: Lloyd, B., Kikumoto, A., Wurm, F., Vives, M.-L.
date: 2026-07-14
generated_at: 2026-07-20 12:18:53 UTC
pdf: https://www.biorxiv.org/content/10.64898/2026.07.13.738284v1.full.pdf
categories:
  venue: []
  task: []
  method: []
  type: []
tags:
- query:rl
score: 0.9
evidence: 强化学习理论的计算建模研究
tldr: 学习通常由预测误差驱动，但完美匹配预期的零预测误差是否具有心理与计算意义尚不清楚。本研究在不确定性环境中操纵部分试次使结果恰好等于被试预测，结合行为建模与脑电分析考察零预测误差对情绪、信念更新及神经反馈加工的影响。结果显示零预测误差引发最高瞬时愉悦感，其效应在高不确定性与高不确定性不耐受个体中尤为突出，P3类脑电成分可预测后续学习差异。该发现表明完美预测并非中性事件，而是主动塑造情感、行为与神经加工的信号。
source: biorxiv
selection_source: fresh_fetch
figures_json: '[{"url": "assets/figures/biorxiv/biorxiv-10-64898-2026-07-13-738284-v1/fig-001.webp",
  "caption": "", "page": 4, "index": 1, "width": 2639, "height": 1140}, {"url": "assets/figures/biorxiv/biorxiv-10-64898-2026-07-13-738284-v1/fig-002.webp",
  "caption": "", "page": 7, "index": 2, "width": 2639, "height": 1104}, {"url": "assets/figures/biorxiv/biorxiv-10-64898-2026-07-13-738284-v1/fig-003.webp",
  "caption": "", "page": 11, "index": 3, "width": 2639, "height": 586}, {"url": "assets/figures/biorxiv/biorxiv-10-64898-2026-07-13-738284-v1/fig-004.webp",
  "caption": "", "page": 13, "index": 4, "width": 2639, "height": 1142}]'
formulas_json: '[{"latex": "error model—compared to the original model—substantially
  improved ﬁt (\\DeltaELPD = 541.86, SE =", "page": 4, "bbox": [72.0, 328.5360107421875,
  543.0001831054688, 342.0360107421875]}, {"latex": "toward the conﬁrmed outcome.
  The degree of persistence is controlled by a free parameter, \\rho, which", "page":
  6, "bbox": [72.0, 139.416015625, 543.0010375976562, 152.916015625]}, {"latex": "determines
  how strongly zero prediction errors inﬂuence future predictions. Higher values of
  \\rho result", "page": 6, "bbox": [72.0, 153.09600830078125, 542.9988403320312,
  166.59600830078125]}, {"latex": "in stronger persistence toward the conﬁrmed outcome,
  whereas lower values of \\rho revert to the", "page": 6, "bbox": [72.0, 166.5360107421875,
  543.0095825195312, 180.0360107421875]}, {"latex": "states, controlled by a free
  parameter, \\omega, which determines the relative inﬂuence of the zero-", "page":
  6, "bbox": [72.0, 341.97601318359375, 540.0059814453125, 355.47601318359375]}, {"latex":
  "predictions. Values of \\omega closer to 1 indicate that predictions are mostly
  driven by the zero-prediction-", "page": 6, "bbox": [72.0, 369.09600830078125, 540.0059814453125,
  382.59600830078125]}, {"latex": "−93,468.97), which substantially outperformed both
  the PH-persist model (\\DeltaELPD = 1,109.92) and", "page": 6, "bbox": [72.0, 544.5360107421875,
  542.9956665039062, 558.0360107421875]}, {"latex": "the PH-standard model (\\DeltaELPD
  = 4,806.30). As shown in Figure 2C, the ZePE model received most", "page": 6, "bbox":
  [72.0, 557.9760131835938, 542.999267578125, 571.4760131835938]}, {"latex": "−67,533.91),
  outperforming both the PH-persist model (\\DeltaELPD = 1,551.16) and the standard
  PH-", "page": 6, "bbox": [72.0, 639.0960083007812, 540.0059814453125, 652.5960083007812]},
  {"latex": "standard model (\\DeltaELPD = 5,062.62). The ZePE model received most
  of the model weight (0.92) and", "page": 6, "bbox": [72.0, 652.5360107421875, 543.0006103515625,
  666.0360107421875]}, {"latex": "To further interrogate this mechanism, we examined
  the free parameter \\omega, which governs the inﬂuence", "page": 7, "bbox": [72.0,
  125.97600555419922, 543.0029296875, 139.47601318359375]}, {"latex": "eﬀect of uncertainty
  on \\omega ( = .002), indicating that \\omega varied systematically across", "page":
  7, "bbox": [72.0, 153.09600830078125, 542.9987182617188, 166.59600830078125]}, {"latex":
  "uncertainty levels. Pairwise comparisons showed that \\omega was signiﬁcantly higher
  in High compared to", "page": 7, "bbox": [72.0, 166.5360107421875, 543.002197265625,
  180.0360107421875]}, {"latex": "= .444; Figure 2E). This pattern indicates that
  \\omega", "page": 7, "bbox": [304.0392150878906, 193.416015625, 543.0006103515625,
  206.916015625]}, {"latex": "data and ZePE model simulations. E) Estimates of the
  free parameter \\omega across uncertainty levels. \\omega", "page": 7, "bbox": [72.0,
  579.5759887695312, 542.9985961914062, 593.0759887695312]}, {"latex": "ZePE model
  (right), split by \\omega tertile. Higher \\omega values were associated with attenuated
  prediction", "page": 7, "bbox": [72.0, 619.89599609375, 543.00390625, 633.39599609375]},
  {"latex": "updates. G) Relationship between Intolerance of Uncertainty and \\omega.
  Participants with higher", "page": 7, "bbox": [72.0, 633.5759887695312, 543.0, 647.0759887695312]},
  {"latex": "intolerance of uncertainty showed larger \\omega values. Data points
  depict individual participants and error", "page": 7, "bbox": [72.0, 647.0159912109375,
  543.003173828125, 660.5159912109375]}, {"latex": "Moreover, we carried out simulations
  in which the mixture parameter \\omega was systematically varied", "page": 8, "bbox":
  [72.0, 395.97601318359375, 542.9987182617188, 409.47601318359375]}, {"latex": "updating
  depended on \\omega: larger \\omega values attenuated the relationship between prediction
  error and", "page": 8, "bbox": [72.0, 423.09600830078125, 543.0064697265625, 436.59600830078125]},
  {"latex": "estimated \\omega values, participants with lower \\omega showed steeper
  PE-to-update relationships, whereas", "page": 8, "bbox": [72.0, 463.416015625, 543.0028686523438,
  476.916015625]}, {"latex": "participants with higher \\omega showed shallower updating.
  We tested this relationship using a linear mixed-", "page": 8, "bbox": [72.0, 477.09600830078125,
  540.0059814453125, 490.59600830078125]}, {"latex": "eﬀects model with continuous
  \\omega and uncertainty level as predictors. This analysis showed that the", "page":
  8, "bbox": [72.0, 490.5360107421875, 543.0000610351562, 504.0360107421875]}, {"latex":
  "relationship between \\omega and absolute prediction updates diﬀered signiﬁcantly
  by uncertainty level, with", "page": 8, "bbox": [72.0, 503.97601318359375, 543.0037841796875,
  517.4760131835938]}, {"latex": "stronger attenuation in Middle blocks, \\omega \\times
  Middle: < .001, and High blocks, \\omega \\times High:", "page": 8, "bbox": [72.0,
  517.416015625, 542.9991455078125, 530.916015625]}, {"latex": "< .001, relative to
  Low blocks. Thus, higher \\omega was associated with reduced behavioral", "page":
  8, "bbox": [130.6474609375, 531.0960083007812, 543.00244140625, 544.5960083007812]},
  {"latex": "\\omega as capturing an attenuation of updating in the best-ﬁtting ZePE
  model.", "page": 8, "bbox": [72.0, 557.9760131835938, 414.80279541015625, 571.4760131835938]},
  {"latex": "Next, we examined whether individual diﬀerences in \\omega were related
  to task performance, indexed by", "page": 8, "bbox": [72.0, 585.0960083007812, 543.0032958984375,
  598.5960083007812]}, {"latex": "uncertainty condition, higher \\omega was associated
  with larger absolute prediction errors,", "page": 8, "bbox": [72.0, 625.416015625,
  475.56890869140625, 638.916015625]}, {"latex": "= .015. However, the eﬀect of \\omega
  diﬀered across uncertainty levels, with weaker \\omega-related eﬀects", "page":
  8, "bbox": [103.92772674560547, 639.0960083007812, 542.9996948242188, 652.5960083007812]},
  {"latex": "< .001, relative to Low uncertainty. Critically, the relationship between
  \\omega, zero-prediction-error", "page": 8, "bbox": [72.0, 665.9760131835938, 543.003173828125,
  679.4760131835938]}, {"latex": "of higher \\omega depended on where zero-prediction-error
  trials occurred relative to the true task mean,", "page": 9, "bbox": [72.0, 71.97600555419922,
  543.0013427734375, 85.47600555419922]}, {"latex": "inﬂuence on updating was modulated
  by \\omega. A linear mixed-eﬀects model revealed that both latent", "page": 9, "bbox":
  [72.0, 168.93603515625, 543.0054931640625, 182.43603515625]}, {"latex": "𝐵 !\"#$
  < .001). Critically, \\omega modulated the", "page": 9, "bbox": [112.51049041748047,
  210.1799774169922, 543.0006103515625, 225.635986328125]}, {"latex": "inﬂuence of
  both signals: higher \\omega increased the contribution of", "page": 9, "bbox":
  [72.0, 225.57598876953125, 377.1550598144531, 239.07598876953125]}, {"latex": "indicate
  that \\omega governs a trade-oﬀ between latent belief states, shifting learning
  away from standard-", "page": 9, "bbox": [72.0, 254.135986328125, 540.0059814453125,
  267.635986328125]}, {"latex": "\\omega. A linear mixed-eﬀects model showed that
  ^{𝐵} ^{*+,}", "page": 9, "bbox": [72.0, 309.53997802734375, 311.11846923828125,
  324.9960021972656]}, {"latex": "latent prediction error signals, with \\omega controlling
  the relative contribution of zero-prediction-error-", "page": 9, "bbox": [72.0,
  338.3760070800781, 540.0059814453125, 351.8760070800781]}, {"latex": ", predicted
  individual diﬀerences in \\omega, while including environmental uncertainty as",
  "page": 9, "bbox": [157.626953125, 500.3760070800781, 543.0049438476562, 513.8759765625]},
  {"latex": "\\omega (", "page": 9, "bbox": [72.0, 527.4959716796875, 85.50057983398438,
  540.9959716796875]}, {"latex": "prediction-error terms, together with their interactions
  with trial type, into a timepoint \\times channel", "page": 11, "bbox": [72.0, 368.6159973144531,
  543.0059204101562, 382.1159973144531]}, {"latex": "!\"#$ _{|} \\times trial type
  + _{|𝑜} _{&} _{−𝐵} _{&} %&''()''#) _{|} \\times trial type + nuisance regressors.
  This _{|𝑜} _{&} _{−𝐵} _{&}", "page": 11, "bbox": [143.374267578125, 381.7799987792969,
  542.998291015625, 399.3840026855469]}, {"latex": "standard-prediction-error trials,
  as indicated by a residual EEG \\times trial type interaction,", "page": 12, "bbox":
  [72.0, 303.09600830078125, 478.938720703125, 316.59600830078125]}, {"latex": "behavioral
  updating was modulated by the weighting parameter \\omega from the ZePE model. To
  this end,", "page": 12, "bbox": [72.0, 384.21600341796875, 542.9998168945312, 397.71600341796875]},
  {"latex": "we extended the previous PPI analysis by including \\omega and its interactions
  with residual EEG activity,", "page": 12, "bbox": [72.0, 397.656005859375, 543.001708984375,
  411.156005859375]}, {"latex": "trial type, and \\omega,", "page": 12, "bbox": [72.0,
  438.21600341796875, 151.137939453125, 451.71600341796875]}, {"latex": "\\omega values
  ampliﬁed the dissociation between trial types: residual EEG activity was increasingly",
  "page": 12, "bbox": [72.0, 478.5360107421875, 543.000732421875, 492.0360107421875]},
  {"latex": "and updating was further modulated by \\omega. Horizontal bars and white
  circles indicate spatiotemporal", "page": 13, "bbox": [72.0, 384.45599365234375,
  543.0050659179688, 397.95599365234375]}, {"latex": "values below \\alpha = .05 were
  considered signiﬁcant.", "page": 18, "bbox": [72.0, 559.656005859375, 302.50775146484375,
  573.156005859375]}, {"latex": "𝐻𝑎𝑝𝑝𝑖𝑛𝑒𝑠𝑠(𝑡) = 𝑤 _{!} _{+ 𝑤} _{\"} _{6 𝛾} #$% 𝑂 _{%}
  + 𝑤 _{''} _{6 𝛾} #$% 𝐸𝑉 _{%} + 𝑤 _{(} _{6 𝛾} #$% |𝑃𝐸 _{%} |", "page": 19, "bbox":
  [134.81935119628906, 413.4360046386719, 477.1888732910156, 429.65087890625]}, {"latex":
  "𝐻𝑎𝑝𝑝𝑖𝑛𝑒𝑠𝑠(𝑡) = 𝑤 _{!} _{+ 𝑤} _{\"} _{6 𝛾} #$% 𝑂 _{%} + 𝑤 _{''} _{6 𝛾} #$% 𝐸𝑉 _{%}
  + 𝑤 _{(} _{6 𝛾} #$% |𝑃𝐸 _{%} | + 𝑤 _{)} _{6 𝛾} #$% 𝑍𝑒𝑟𝑜𝑃𝐸 _{%}", "page": 19, "bbox":
  [81.484130859375, 534.156005859375, 529.7464599609375, 550.370849609375]}, {"latex":
  "\\le𝛾\\le1)", "page": 19, "bbox": [84.123046875, 604.199951171875, 130.35084533691406,
  618.2639770507812]}, {"latex": "𝛿 _{&} = 𝑜 _{&} _{−𝑦} _{&}", "page": 20, "bbox":
  [273.7773742675781, 72.1200180053711, 337.44842529296875, 88.583984375]}, {"latex":
  "𝛼 _{&3/} = 𝛾 ^{|𝛿} ^{&} ^{|}", "page": 20, "bbox": [240.3369598388672, 209.16000366210938,
  308.11199951171875, 235.2239990234375]}, {"latex": "𝑐 𝑐= 100 𝛾 \\in[0, 1]", "page":
  20, "bbox": [104.22827911376953, 251.88003540039062, 368.8821716308594, 265.94403076171875]},
  {"latex": "𝐵 _{&3/} = 𝐵 _{&} _{+ 𝛼} _{&} 𝛿 _{&}", "page": 20, "bbox": [261.2275085449219,
  376.44000244140625, 349.9982604980469, 392.90399169921875]}, {"latex": "𝑧 _{&} 𝑧
  _{&} = 1", "page": 20, "bbox": [359.61767578125, 487.08001708984375, 438.6079406738281,
  503.54400634765625]}, {"latex": "𝑧 _{&} = 0", "page": 20, "bbox": [72.0, 501.7200012207031,
  104.25713348388672, 518.1840209960938]}, {"latex": "∗ _{𝐵} _{&3/} _{= 𝐵} _{&} _{+
  𝛼} _{&} _{𝛿} _{&}", "page": 20, "bbox": [261.2275085449219, 542.1000366210938, 349.9982604980469,
  559.7039794921875]}, {"latex": "∗ _{𝐵} _{&3/} = 𝑝𝑜 _{&} + (1 −𝑝)𝐵 _{&3/}", "page":
  20, "bbox": [239.26318359375, 597.780029296875, 372.183837890625, 615.3839721679688]},
  {"latex": "𝑜 _{&} 𝑝 \\in[0, 2]", "page": 20, "bbox": [103.59718322753906, 626.5199584960938,
  536.5007934570312, 642.184814453125]}, {"latex": "∗ ∗ _{𝐵} _{&3/} _{= 𝐵} _{&3/}
  _{+ 𝑧} _{&} _{𝜌[𝑟} _{&} _{−𝐵} _{&3/} _{]}", "page": 20, "bbox": [232.45094299316406,
  666.9000244140625, 379.5480041503906, 684.5039672851562]}, {"latex": "𝑧 _{&} = 0
  𝑧 _{&} = 1", "page": 21, "bbox": [99.69142150878906, 72.1200180053711, 412.0351257324219,
  88.583984375]}, {"latex": "!\"#$ ),                   if 𝑃𝐸 _{&} _{= 0} _{= H} _{𝐵}
  _{&}", "page": 21, "bbox": [198.79493713378906, 211.37998962402344, 439.4275207519531,
  235.94403076171875]}, {"latex": "%&''()''#) L,   if 𝑃𝐸 _{&} \\ne0", "page": 21,
  "bbox": [332.9064025878906, 228.42002868652344, 439.46160888671875, 246.02398681640625]},
  {"latex": "𝑃𝐸 _{&} = 0", "page": 21, "bbox": [253.88519287109375, 272.0400085449219,
  294.9256896972656, 288.5039978027344]}, {"latex": "𝑃𝐸 _{&} \\ne0", "page": 21, "bbox":
  [126.873046875, 300.1199951171875, 167.9133758544922, 316.5840148925781]}, {"latex":
  "*+, = 𝜔𝐵 _{&} !\"#$ + (1 −𝜔)𝐵 _{&}", "page": 21, "bbox": [222.84083557128906, 378.3600158691406,
  359.80682373046875, 398.8247985839844]}, {"latex": "𝜔\\in[0, 1]", "page": 21, "bbox":
  [105.13645935058594, 410.52001953125, 154.4014129638672, 424.5840148925781]}, {"latex":
  "𝛼 _{.} = 0.17 𝛾= 0.06 𝜎= 18. 𝛼 _{.} = 0.72 𝛾= 0.21", "page": 22, "bbox": [72.0,
  168.36001586914062, 537.3781127929688, 184.823974609375]}, {"latex": "𝜔= 0.52 𝜎=
  13.", "page": 22, "bbox": [72.0, 183.00003051757812, 187.2571258544922, 197.06402587890625]},
  {"latex": "𝛼 _{.} , 𝛾\\in[0,1] 𝜌\\in[0,2] 𝜔\\in[0,1] 𝜎\\in[1,12]", "page": 22, "bbox":
  [167.7197265625, 386.52001953125, 422.1422424316406, 402.184814453125]}]'
motivation: 强化学习理论强调预测误差驱动学习，但零预测误差（即结果完全符合预期）的心理与计算作用尚不明确。
method: 被试在不确定性环境中反复预测奖励，部分试次结果被操纵为恰好匹配预测，结合计算模型拟合与结果锁定EEG分析。
result: 零预测误差引发最高瞬时愉悦感，其触发的P3类脑电活动可预测后续信念更新减弱；在高不确定性与高不确定性不耐受者中效应更强。
conclusion: 完美预测并非中性事件，而是承载特定信念状态、主动塑造情感、行为与神经反馈加工的具有信息量的信号。
context: 本研究将强化学习预测误差框架从'偏差信号'扩展到'确认信号'维度，承接近年来关于预期匹配的神经计算工作，适用于高不确定环境的学习建模，相关机制仍有待深入。
---

## 摘要
学习通常被理解为一个由预测误差驱动的过程，即当结果与预期不符时发生。然而，当结果完全符合预期时是否具有心理学和计算上的意义仍不清楚。本研究检验了零预测误差是否影响人类强化学习中的情感、信念更新以及神经反馈加工。参与者在不同不确定性的环境中反复预测奖励，其中部分试次的结果被操纵为恰好与其预测匹配。零预测误差产生了最高的瞬时幸福感，计算建模显示，行为最能得到解释的模型是：零预测误差诱发一种独特的潜在信念状态，该状态在更高不确定性下以及在不确定性容忍度较低的个体中，引导后续更新。结果锁定的脑电分析进一步显示，零预测误差引发了独特的类P3反应，残余神经活动可以预测零预测误差后减弱的更新，但在标准预测误差后则预测增强的更新。这些发现表明，完美预测并非中性事件，而是具有信息性的事件，能够主动塑造情感、行为和神经反馈加工。

## Abstract
Learning is typically understood as a process driven by prediction errors, when outcomes differ from expectations. Yet it remains unclear whether outcomes that perfectly match expectations are psychologically and computationally meaningful. Here, we tested whether zero prediction errors shape affect, belief updating, and neural feedback processing in human reinforcement learning. Participants repeatedly predicted rewards in environments varying in uncertainty, with a subset of trial outcomes manipulated to exactly match their predictions. Zero prediction errors produced the highest momentary happiness, and computational modeling showed that behavior was best explained by a model in which zero prediction errors induce a distinct latent belief state that guides subsequent updating, particularly under higher uncertainty and in individuals with greater intolerance of uncertainty. Outcome-locked EEG analyses further showed that zero prediction errors elicited distinct P3-like responses, with residual neural activity predicting attenuated updating after zero prediction errors but enhanced updating after standard prediction errors. These findings suggest that perfect predictions are not neutral, but informative events that actively shape affect, behavior, and neural feedback processing.