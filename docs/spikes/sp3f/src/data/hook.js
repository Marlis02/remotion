window.__HOOK = {
 "schema": "sp3f-data/1",
 "comment": "SP-3f: все значения композиции. Время только в кадрах. Никакого Math.random/Date.now (Charter V8/V9).",
 "fps": 30,
 "durationInFrames": 450,
 "width": 1080,
 "height": 1920,
 "compositionId": "hook",
 "scale": 1,
 "layers": {
  "shader": true,
  "depth": true,
  "type": true,
  "particles": true,
  "card": true,
  "melt": true,
  "captions": true
 },
 "palette": {
  "ink": "#05070c",
  "ember": "#ff7a2f",
  "emberHi": "#ffb347",
  "gold": "#ffd28a",
  "cold": "#dff3ff",
  "dim": "rgba(223,243,255,0.42)",
  "line": "rgba(255,180,110,0.55)"
 },
 "windows": {
  "bg": {
   "from": 0,
   "to": 450
  },
  "depth": {
   "from": 0,
   "to": 360
  },
  "type": {
   "from": 30,
   "to": 160
  },
  "particles": {
   "from": 120,
   "to": 215
  },
  "card": {
   "from": 200,
   "to": 305
  },
  "melt": {
   "from": 290,
   "to": 362
  },
  "final": {
   "from": 300,
   "to": 450
  },
  "captions": {
   "from": 40,
   "to": 447
  }
 },
 "shader": {
  "w": 360,
  "h": 640,
  "breatheFrames": 450
 },
 "depth": {
  "pushFrames": 150,
  "layers": [
   {
    "file": "depth-0.jpg",
    "scaleFrom": 1,
    "scaleTo": 1.045,
    "yFrom": 0,
    "yTo": -14,
    "blurPx": 5,
    "opacity": 0.55,
    "fadeFrames": 44
   },
   {
    "file": "depth-1.jpg",
    "scaleFrom": 1,
    "scaleTo": 1.085,
    "yFrom": 0,
    "yTo": -30,
    "blurPx": 3,
    "opacity": 0.7,
    "fadeFrames": 40
   },
   {
    "file": "depth-2.jpg",
    "scaleFrom": 1,
    "scaleTo": 1.135,
    "yFrom": 0,
    "yTo": -52,
    "blurPx": 1.4,
    "opacity": 0.82,
    "fadeFrames": 36
   },
   {
    "file": "depth-3.jpg",
    "scaleFrom": 1,
    "scaleTo": 1.2,
    "yFrom": 0,
    "yTo": -84,
    "blurPx": 0,
    "opacity": 0.92,
    "fadeFrames": 32
   }
  ]
 },
 "type": {
  "text": "The morning began the same way for almost 200 years running.",
  "keyword": "200",
  "staggerFrames": 3,
  "riseFrames": 15,
  "blurPx": 8,
  "riseY": 66,
  "shineFrom": 96,
  "shineFrames": 34,
  "outFrom": 146,
  "outFrames": 14
 },
 "particles": {
  "count": 2600,
  "assembleFrames": 62,
  "holdFrames": 16,
  "outFrames": 16,
  "cx": 540,
  "cy": 880,
  "flameH": 660,
  "flameW": 320,
  "chaosR": 780,
  "dotPx": 3
 },
 "card": {
  "text": "Ships came in on the night tide, and the town woke to their horns.",
  "inFrames": 26,
  "rotYFrom": 26,
  "xFrom": 210,
  "outFrom": 288,
  "outFrames": 17,
  "morphFrom": 232,
  "morphFrames": 34,
  "nodes": 12
 },
 "melt": {
  "w": 270,
  "h": 480,
  "thresholdFrames": 54,
  "cell": 7.5
 },
 "final": {
  "text": "The harbour warehouses held goods that nobody in town ever bought.",
  "inFrom": 322,
  "inFrames": 22,
  "top": 620,
  "fontPx": 74
 },
 "captions": {
  "startFrame": 40,
  "wordFrames": 11,
  "maxWordsPerPage": 4,
  "maxCharsPerPage": 26,
  "safeBottom": 320,
  "safeSide": 60,
  "scrimTop": 1100,
  "plateTop": 1424,
  "bandTop": 1444,
  "bandBottom": 1592,
  "fontPx": 54,
  "words": [
   {
    "i": 0,
    "text": "The",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 40,
    "endFrame": 51
   },
   {
    "i": 1,
    "text": "morning",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 51,
    "endFrame": 62
   },
   {
    "i": 2,
    "text": "began",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 62,
    "endFrame": 73
   },
   {
    "i": 3,
    "text": "the",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 73,
    "endFrame": 84
   },
   {
    "i": 4,
    "text": "same",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 84,
    "endFrame": 95
   },
   {
    "i": 5,
    "text": "way",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 95,
    "endFrame": 106
   },
   {
    "i": 6,
    "text": "for",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 106,
    "endFrame": 117
   },
   {
    "i": 7,
    "text": "almost",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 117,
    "endFrame": 128
   },
   {
    "i": 8,
    "text": "200",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 128,
    "endFrame": 139
   },
   {
    "i": 9,
    "text": "years",
    "sentence": 0,
    "lastInSentence": false,
    "startFrame": 139,
    "endFrame": 150
   },
   {
    "i": 10,
    "text": "running.",
    "sentence": 0,
    "lastInSentence": true,
    "startFrame": 150,
    "endFrame": 161
   },
   {
    "i": 11,
    "text": "Ships",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 161,
    "endFrame": 172
   },
   {
    "i": 12,
    "text": "came",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 172,
    "endFrame": 183
   },
   {
    "i": 13,
    "text": "in",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 183,
    "endFrame": 194
   },
   {
    "i": 14,
    "text": "on",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 194,
    "endFrame": 205
   },
   {
    "i": 15,
    "text": "the",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 205,
    "endFrame": 216
   },
   {
    "i": 16,
    "text": "night",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 216,
    "endFrame": 227
   },
   {
    "i": 17,
    "text": "tide,",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 227,
    "endFrame": 238
   },
   {
    "i": 18,
    "text": "and",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 238,
    "endFrame": 249
   },
   {
    "i": 19,
    "text": "the",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 249,
    "endFrame": 260
   },
   {
    "i": 20,
    "text": "town",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 260,
    "endFrame": 271
   },
   {
    "i": 21,
    "text": "woke",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 271,
    "endFrame": 282
   },
   {
    "i": 22,
    "text": "to",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 282,
    "endFrame": 293
   },
   {
    "i": 23,
    "text": "their",
    "sentence": 1,
    "lastInSentence": false,
    "startFrame": 293,
    "endFrame": 304
   },
   {
    "i": 24,
    "text": "horns.",
    "sentence": 1,
    "lastInSentence": true,
    "startFrame": 304,
    "endFrame": 315
   },
   {
    "i": 25,
    "text": "The",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 315,
    "endFrame": 326
   },
   {
    "i": 26,
    "text": "harbour",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 326,
    "endFrame": 337
   },
   {
    "i": 27,
    "text": "warehouses",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 337,
    "endFrame": 348
   },
   {
    "i": 28,
    "text": "held",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 348,
    "endFrame": 359
   },
   {
    "i": 29,
    "text": "goods",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 359,
    "endFrame": 370
   },
   {
    "i": 30,
    "text": "that",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 370,
    "endFrame": 381
   },
   {
    "i": 31,
    "text": "nobody",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 381,
    "endFrame": 392
   },
   {
    "i": 32,
    "text": "in",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 392,
    "endFrame": 403
   },
   {
    "i": 33,
    "text": "town",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 403,
    "endFrame": 414
   },
   {
    "i": 34,
    "text": "ever",
    "sentence": 2,
    "lastInSentence": false,
    "startFrame": 414,
    "endFrame": 425
   },
   {
    "i": 35,
    "text": "bought.",
    "sentence": 2,
    "lastInSentence": true,
    "startFrame": 425,
    "endFrame": 436
   }
  ],
  "pages": [
   {
    "index": 0,
    "words": [
     0,
     1,
     2,
     3
    ],
    "chars": 21,
    "startFrame": 40,
    "endFrame": 84,
    "text": "The morning began the"
   },
   {
    "index": 1,
    "words": [
     4,
     5,
     6,
     7
    ],
    "chars": 19,
    "startFrame": 84,
    "endFrame": 128,
    "text": "same way for almost"
   },
   {
    "index": 2,
    "words": [
     8,
     9,
     10
    ],
    "chars": 18,
    "startFrame": 128,
    "endFrame": 161,
    "text": "200 years running."
   },
   {
    "index": 3,
    "words": [
     11,
     12,
     13,
     14
    ],
    "chars": 16,
    "startFrame": 161,
    "endFrame": 205,
    "text": "Ships came in on"
   },
   {
    "index": 4,
    "words": [
     15,
     16,
     17,
     18
    ],
    "chars": 19,
    "startFrame": 205,
    "endFrame": 249,
    "text": "the night tide, and"
   },
   {
    "index": 5,
    "words": [
     19,
     20,
     21,
     22
    ],
    "chars": 16,
    "startFrame": 249,
    "endFrame": 293,
    "text": "the town woke to"
   },
   {
    "index": 6,
    "words": [
     23,
     24
    ],
    "chars": 12,
    "startFrame": 293,
    "endFrame": 315,
    "text": "their horns."
   },
   {
    "index": 7,
    "words": [
     25,
     26,
     27
    ],
    "chars": 22,
    "startFrame": 315,
    "endFrame": 348,
    "text": "The harbour warehouses"
   },
   {
    "index": 8,
    "words": [
     28,
     29,
     30,
     31
    ],
    "chars": 22,
    "startFrame": 348,
    "endFrame": 392,
    "text": "held goods that nobody"
   },
   {
    "index": 9,
    "words": [
     32,
     33,
     34,
     35
    ],
    "chars": 20,
    "startFrame": 392,
    "endFrame": 436,
    "text": "in town ever bought."
   }
  ]
 }
};
