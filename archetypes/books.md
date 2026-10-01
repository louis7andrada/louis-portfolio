---
id: "{{ .File.ContentBaseName }}"
slug: "{{ .File.ContentBaseName }}"
imageBase: "https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/books/{{ .File.ContentBaseName }}"
title: '{{ replace .File.ContentBaseName "-" " " | title }}'
order: 1
year: {{ dateFormat "2006" now }}
size: ""
medium: ""
availability: "In-progress"
price: 0
description: ""
pageMode: "spread"
defaultPageView: "two"
pageCount: 0
framesPerFlip: 6
framesPerOpenClose: 8
fps: 12
comment: ""
---
