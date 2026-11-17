import json
d=json.load(open('prieres.json',encoding='utf8'))
s=open('src.html',encoding='utf8').read()
assert s.count('__DAILY__')==1
open('temps-abondance.html','w',encoding='utf8').write(s.replace('__DAILY__',json.dumps(d,ensure_ascii=False,separators=(',',':'))))
print('built',len(d),'prayers')
