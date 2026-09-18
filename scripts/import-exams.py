#!/usr/bin/env python3
"""Import the two general-business subjects from a local past-paper collection.

Usage: python3 scripts/import-exams.py SOURCE_DIRECTORY
Requires Poppler. Original files stay local; the normalized corpus and audit are
reproducible, and no model/provider or external upload is used.
"""
import argparse
import collections
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
# 有些来源把左书名号识别丢了，答案写成「参考答案】ABC」，这里一并认。
ANS = re.compile(r'(?:【\s*(?:参考|正确)?答案\s*】|(?:参考|正确)答案\s*】|(?:参考|正确)?答案\s*[:：])[ \t]*([A-EＡ-Ｅ][A-EＡ-Ｅ、,， \t]*|正确|错误|对|错|√|×)', re.M)
# 题号后的点号若紧跟 1~3 位数字（如「10.40元」「1.5%」），那是金额或比例，不是题号；
# 四位数年份（如「97.1995年以来」）仍按题号处理。
START = re.compile(r'^[ \t]*(?:(?:第[ \t]*)?(\d{1,3})[ \t]*[.．、](?!\d{1,3}(?!\d))|第[ \t]*(\d{1,3})[ \t]*题|[（(](?P<sub>\d{1,2})[）)]|(?P<plain>\d{1,3})[ \t]*(?:[（(]多选[）)]|多选题|判断题)?[ \t]*$)', re.M)
OPT = re.compile(r'(?<![A-Za-z])([A-E])[.．、]|^[ \t]*([A-E])[ \t]+', re.M)
SECTION = re.compile(r'^[ \t]*(?:[一二三四五][、．.]\s*)?(单项选择题|单选题|多项选择题|多选题|判断题|共享题干题|综合题|材料题|不定项选择题|组合型选择题)[^\n]*', re.M)
MATERIAL = re.compile(r'【题干】|\[题干\]|根据(?:以下|下列|下面)(?:资料|材料)[，,：:]?')
# 材料题的段落标题（「四、材料题」下的「材料一:」「材料二：」）也算一段材料的起点。
PASSAGE = re.compile(r'【题干】|\[题干\]|根据(?:以下|下列|下面)(?:资料|材料)[，,：:]?|材料[一二三四五六七八九十\d]{0,3}\s*[:：]')


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def normalize(value):
    return re.sub(r'[^\w\u4e00-\u9fff%≥≤<>=+−÷×]', '', value).lower()


def option_key(value):
    # 判重时保留分隔符："Ⅰ.Ⅱ.Ⅳ" 和 "Ⅲ.Ⅳ" 不是重复选项。
    return re.sub(r'[\s\u3000]+', '', value).replace('，', ',').replace('。', '.').replace('．', '.').lower()


# 有些来源的解析会把下一题整段吞进来（「8.…【参考答案】B」），合并时要挑真正的解析，
# 否则「最长优先」会把脏解析选上来，清洗后反而变成占位说明。
NEXT_Q = re.compile(r'(?:^|\n)[ \t]*\d{1,3}[ \t]*[、.．][ \t]*(?=[^\s\d])')
DIRTY_ANS = re.compile(r'参考答案|【\s*(?:参考|正确)?答案|【\s*解析\s*】|慧考解析|刷题软件|命中率')


PLACEHOLDER_ANS = '原资料未提供可用解析'


def explanation_score(value):
    text = value or ''
    if not text:
        return -1
    # 占位说明不算解析：只要别处有一句真解析，哪怕很短也用真的。
    if text.startswith(PLACEHOLDER_ANS):
        return 1
    if DIRTY_ANS.search(text) or (NEXT_Q.search(text) and '解析' in text):
        return -1000000 - len(text)
    return len(text)


def better_explanation(candidate, current):
    return explanation_score(candidate) > explanation_score(current)


def compact(value):
    # Keep paragraph/statement boundaries, join only PDF wrapping lines.
    value = re.sub(r'\n[ \t]*\n+', '\n', value.replace('\f', '\n')).strip()
    return re.sub(r'(?<=[\u4e00-\u9fff，、（(])\n(?=[\u4e00-\u9fff，。、）)])', '', value)


def clean_text(raw, plain=False):
    pages = []
    for page in raw.split('\f'):
        lines = []
        for line in page.split('\n'):
            if any(w in line for w in ['命中率', '老店铺加好友', '刷题软件', '精讲冲刺真题解析', 'haomingzi3388', '绝密押题', '全班次网课']):
                continue
            line = re.sub(r'金融类押题微信\s*308252680[）)]?', '', line)
            line = re.sub(r'证券从业\s*[-—－]?\s*(?:证券市场基本法律法规|金融市场基础知识)', '', line)
            line = re.sub(r'\bJMYT\s*\d*\s*获取?\b', '', line, flags=re.I)
            # 版心外的页码噪声常常粘在句尾，例如「…从业资格26 8」。
            line = re.sub(r'(?<=[\u4e00-\u9fff])\s?\d{1,3}\s+\d{1,2}(?=\s*$|\s*[\u4e00-\u9fff])', '', line)
            line = re.sub(r'(?<=[\u4e00-\u9fff])\.(?=[\u4e00-\u9fff])', '、', line)
            line = line.replace('劵', '券').replace('胞资', '融资')
            line = re.sub(r'\s{3,}(?:[0-9 ]{1,10}|[金融类押题认准微信])\s*$', '', line)
            if re.fullmatch(r'\s*[金融类押题认准微信]\s*', line):
                continue
            if re.fullmatch(r'\s*(?:JMYT\s*\d*\s*获取?|证券从业\s*[-—－]?\s*(?:证券市场基本法律法规|金融市场基础知识))\s*', line, flags=re.I):
                continue
            if not plain and re.fullmatch(r'\s*\d{1,3}(?:\s*/\s*\d+)?\s*', line):
                continue
            lines.append(line.rstrip())
        pages.append('\n'.join(lines))
    return '\n\f\n'.join(pages)


def options_in(text):
    text = text.replace('\f', '\n')
    text = re.sub(r'([AB])[ \t]+(对|错|正确|错误)[ \t]+(?=[AB][ \t])', r'\1 \2\n', text)
    matches = list(OPT.finditer(text))
    # The option alphabet must start at A, continue in order, and appear once.
    for begin, m in enumerate(matches):
        if (m[1] or m[2]) != 'A':
            continue
        found = [m]
        for nxt in matches[begin + 1:]:
            if (nxt[1] or nxt[2]) == chr(65 + len(found)):
                found.append(nxt)
            else:
                break
        if len(found) >= 2:
            options = [{'id': m[1] or m[2], 'text': compact(text[m.end():found[j+1].start() if j+1 < len(found) else len(text)])} for j, m in enumerate(found)]
            return compact(text[:found[0].start()]), options
    return compact(text), []


# 「（1）检查公司财务；」这类正文列举也长得像（n）题号，只有材料题区段里的（n）才当小问。
CASE_SECTIONS = ['共享题干题', '综合题', '材料题', '不定项选择题']


def is_question_start(marker, sections):
    if not marker.group('sub'):
        return True
    enclosing = [s for s in sections if s.start() < marker.start()]
    return bool(enclosing) and enclosing[-1][1] in CASE_SECTIONS


def parse_source(source, text):
    starts = list(START.finditer(text))
    answers = list(ANS.finditer(text))
    sections = list(SECTION.finditer(text))
    occurrences, rejected = [], []
    used = set()
    active_material = None
    for ai, answer in enumerate(answers):
        prior_end = answers[ai-1].end() if ai else 0
        candidates = [s for s in starts if prior_end <= s.start() < answer.start()]
        selected = None
        for candidate in reversed(candidates):
            if candidate.group('plain') and source['year'] != 2026:
                continue
            if not is_question_start(candidate, sections):
                continue
            pre = text[candidate.end():answer.start()]
            stem, options = options_in(pre)
            # A parsed question must have options; bare judgment handled below.
            if options and len(stem) >= 4:
                selected = candidate, stem, options
                break
        if selected is None:
            # Some recent recollections omit the True/False options altogether.
            for candidate in reversed(candidates):
                preceding = [s for s in sections if s.start() < candidate.start()]
                label = preceding[-1][1] if preceding else ''
                pre = compact(text[candidate.end():answer.start()])
                if ('判断' in label or '判断' in candidate[0]) and 4 <= len(pre) < 1000:
                    selected = candidate, pre, [{'id':'A','text':'正确'}, {'id':'B','text':'错误'}]
                    break
        if selected is None:
            rejected.append({'page': text[:answer.start()].count('\f')+1, 'reason': '答案附近未能完整识别题干和选项', 'raw': text[max(prior_end, answer.start()-1500):answer.end()+150]})
            continue
        start, stem, options = selected
        if start.start() in used:
            continue
        used.add(start.start())
        number = next(g for g in start.groups() if g is not None)
        preceding = [s for s in sections if s.start() < start.start()]
        label = preceding[-1][1] if preceding else ''
        following = [s.start() for s in starts if s.start() >= answer.end() and (not s.group('plain') or source['year'] == 2026)]
        # Stop explanations at the next actual question (requires an A option).
        end = len(text)
        for s in starts:
            if s.start() <= answer.end() or not is_question_start(s, sections):
                continue
            next_answer = next((a for a in answers if a.start() > s.end()), None)
            if not next_answer:
                continue
            segment = text[s.end():next_answer.start()]
            # 解析里的「1.…；2.…；3.…」列举也长得像题号。真正的下一题，从题号到它自己的答案
            # 之间不会再冒出一个能解析出选项的题号；材料题里的（n）小问属于当前这道题，不算。
            # 材料题的小问用「（1）」标注，解析里也常这么列举；只有当这个候选本身不是小问时，
            # 才把后面的（n）当成它内部的小问，否则解析就会在列举的第一条被截断。
            nested = [t for t in starts
                      if s.end() <= t.start() < next_answer.start() and (s.group('sub') or not t.group('sub'))
                      and is_question_start(t, sections) and options_in(text[t.end():next_answer.start()])[1]]
            if nested:
                continue
            if options_in(segment)[1]:
                end = s.start()
                break
            # 有些来源把选项排成了图，文字层里只剩题干；这时下一题很短，也要止住解析。
            if len(compact(segment)) <= 160 and not ANS.search(segment):
                end = s.start()
                break
        for sec in sections:
            if answer.end() < sec.start() < end:
                end = sec.start()
                break
        explanation = text[answer.end():end]
        # A shared passage is often at the end of the previous explanation.
        gap = text[prior_end:start.start()]
        passages = list(PASSAGE.finditer(gap))
        if passages:
            material = compact(gap[passages[-1].end():])
            active_material = {'text':material, 'id':source['id']+'-case-'+digest(material)[:10]}
        elif label in ['共享题干题','综合题','材料题','不定项选择题'] and start.group('sub'):
            parent = [s for s in starts if prior_end <= s.start() < start.start() and not s.group('sub') and not s.group('plain')]
            if parent:
                material = compact(text[parent[-1].end():start.start()])
                active_material = {'text':material, 'id':source['id']+'-case-'+digest(material)[:10]}
        if label not in ['共享题干题', '综合题', '材料题', '不定项选择题']:
            active_material = None
        mat = MATERIAL.search(explanation)
        if mat:
            explanation = explanation[:mat.start()]
        explanation = re.sub(r'^[\s（(]*(?:对|错)[）)]\s*', '', explanation)
        explanation = re.sub(r'^\s*(?:【[^】]*解析】|(?:详细)?解析\s*[:：]?)\s*', '', explanation)
        explanation = compact(explanation)
        correct = answer[1].translate(str.maketrans('ＡＢＣＤＥ', 'ABCDE')).strip()
        correct = {'正确':'A','对':'A','√':'A','错误':'B','错':'B','×':'B'}.get(correct, correct)
        correct = sorted(set(re.findall('[A-E]',correct)))
        judgment = len(options)==2 and all(normalize(o['text']) in ['正确','错误','对','错'] for o in options)
        # 「材料题」区段里也可能夹着独立成题的小问：没有材料文本时按普通题处理，
        # 否则会被当成「缺材料的综合题」扣下，白丢一道题。
        is_case = bool(active_material) or label in ['共享题干题','综合题','不定项选择题'] or '【不定项' in stem
        typ = 'judgment' if judgment else 'case' if is_case else 'multiple' if len(correct)>1 else 'single'
        issues = []
        if not correct or not set(correct).issubset({o['id'] for o in options}): issues.append('答案与选项不匹配')
        if not judgment and len(options) != 4: issues.append('选项数量异常')
        if any(not o['text'] or len(o['text'])>750 for o in options): issues.append('选项缺失或疑似跨题')
        if len({option_key(o['text']) for o in options}) != len(options): issues.append('选项文字重复')
        if len(stem)>1800 or '参考答案' in stem or '【解析】' in stem: issues.append('题干疑似混入其他内容')
        if is_case and not active_material: issues.append('综合题材料待恢复')
        if re.search(r'此题暂无解析|暂无解析', explanation): explanation = ''
        if not explanation:
            explanation = '原资料未提供可用解析；请结合教材定位和现行官方规则自行核对。'
        origin = {'sourceId':source['id'], 'number':str(number), 'page':text[:start.start()].count('\f')+1 if source['format']=='pdf' else None,
                  'section':label, 'answer':correct, 'explanation':explanation, 'year': source['year']}
        occurrences.append({'subjectId':source['subjectId'],'type':typ,'selectionMode':'multiple' if typ in ['multiple','case'] else 'single',
            'stem':stem,'options':options,'correctOptionIds':correct,'explanation':explanation,
            'caseMaterial':active_material['text'] if active_material else None,'caseGroupId':active_material['id'] if active_material else None,
            'origins':[origin],'issues':issues,'year':source['year'], 'sourceKind':source['kind']})
    return occurrences, rejected, len(answers)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source',type=Path)
    args=cli.parse_args()
    directory = args.source
    archive = ROOT/'docs/exam-sources';archive.mkdir(parents=True,exist_ok=True)
    cache = ROOT/'tmp/exam-import';cache.mkdir(parents=True,exist_ok=True)
    sources, questions, rejected, audit = [], [], [], []
    for path in sorted(directory.rglob('*')):
        if path.suffix.lower() not in ['.pdf','.docx']:continue
        rel = str(path.relative_to(directory))
        if '历年真题' not in rel or not any(w in rel for w in ['/金融市场基础知识/','/证券市场基础法规/']):continue
        subject='finance' if '/金融市场基础知识/' in rel else 'law'
        fingerprint=digest(path.read_bytes())
        source={'id':subject+'-'+digest(rel)[:12],'title':path.stem,'relativePath':rel,'sha256':fingerprint,
                'subjectId':subject,'year':int(re.search(r'20\d{2}',path.name)[0]),'format':path.suffix[1:],
                'kind':'mock' if re.search('冲刺|模拟|押题|预测',path.stem) else 'recalled'}
        source['localPath']='./docs/exam-sources/'+source['id']+path.suffix
        shutil.copy2(path,ROOT/source['localPath'])
        txt=cache/(fingerprint+'-layout.txt')
        if not txt.exists():
            if path.suffix=='.pdf':
                subprocess.run(['pdftotext','-layout',str(path),str(txt)],check=True)
            else:
                with zipfile.ZipFile(path) as z:tree=ET.fromstring(z.read('word/document.xml'))
                ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                txt.write_text('\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in tree.findall('.//w:p',ns)))
        text=clean_text(txt.read_text(),source['year']==2026)
        parsed, failed, answer_count=parse_source(source,text)
        for item in failed:item['sourceId']=source['id']
        rejected.extend(failed);questions.extend(parsed)
        source.update(answerMarkerCount=answer_count,extractedCount=len(parsed),unparsedCount=len(failed))
        sources.append(source)
        (cache/(source['id']+'.txt')).write_text(text)
        print(source['title'],len(parsed),'questions;',len(failed),'unparsed',flush=True)
    # Merge exact content, irrespective of option letter ordering; conflicts stay visible.
    merged={}
    for q in questions:
        key=q['subjectId']+'|'+normalize(q['stem'])+'|'+ '|'.join(sorted(normalize(o['text']) for o in q['options']))+'|'+normalize(q['caseMaterial'] or '')
        if key in merged:
            target=merged[key]
            remap={o['id']:next(t['id'] for t in target['options'] if normalize(t['text'])==normalize(o['text'])) for o in q['options']}
            if sorted(remap[a] for a in q['correctOptionIds'] if a in remap)!=target['correctOptionIds']:
                target['issues'].append('不同来源答案冲突')
            target['origins'].extend(q['origins'])
            if better_explanation(q['explanation'],target['explanation']):target['explanation']=q['explanation']
            target['year']=max(q['year'],target['year'])
            if q['sourceKind']=='recalled':target['sourceKind']='recalled'
        else:
            q['id']='IMP-'+q['subjectId'][0].upper()+'-'+digest(key)[:16]
            merged[key]=q
    questions=list(merged.values())
    # Conservative second-pass deduplication: papers often preserve the same
    # stem while reordering or rewording distractors. Merge only when the
    # subject/type/stem and the normalized correct answer text agree.
    clusters = {}
    deduped = []
    for q in questions:
        correct_text = tuple(sorted(normalize(next((o['text'] for o in q['options'] if o['id'] == aid), '')) for aid in q['correctOptionIds']))
        key = (q['subjectId'], q['type'], normalize(q['stem']), correct_text)
        prior = clusters.get(key)
        if prior is None:
            clusters[key] = q; deduped.append(q)
            continue
        prior['origins'].extend(q.get('origins', []))
        prior['issues'] = sorted(set(prior.get('issues', []) + q.get('issues', [])))
        if better_explanation(q.get('explanation',''), prior.get('explanation','')): prior['explanation'] = q['explanation']
        prior['year'] = max(prior.get('year', 0), q.get('year', 0))
        if q.get('sourceKind') == 'recalled': prior['sourceKind'] = 'recalled'
    questions = deduped
    patches_path=ROOT/'content/exam-corrections.json'
    patches=json.loads(patches_path.read_text()) if patches_path.exists() else []
    for q in questions:
        q['issues']=sorted(set(q['issues']))
        for patch in patches:
            if patch.get('id')==q['id'] or (patch.get('stemContains') and patch['stemContains'] in normalize(q['stem'])):
                q.setdefault('corrections',[]).append(patch['reason'])
                for field in ['stem','correctOptionIds','explanation']: 
                    if field in patch:q[field]=patch[field]
                if patch.get('originNumber') and q.get('origins'):q['origins'][0]['number']=str(patch['originNumber'])
                if patch.get('hold'):q['issues'].append(patch['reason'])
        q['reviewStatus']='held' if q['issues'] else 'source_answer'
        q['verificationStatus']='source_transcribed'
        q['version']=1
        q['negation']=bool(re.search('不属于|不包括|错误|不正确|不符合',q['stem']))
        q['examEligible']=not q['issues']
        years = sorted({int(o.get('year')) for o in q.get('origins', []) if str(o.get('year','')).isdigit()})
        q['repeatYears'] = years
        q['repeatCount'] = len(q.get('origins', []))
        q['repeatLabel'] = ('多年考点 · ' + ' / '.join(map(str, years))) if len(years) >= 2 else ('重复出现 · ' + str(years[0]) if q['repeatCount'] > 1 and years else None)
    # Group sizes belong to the imported passage, not to a fixed four-question template.
    groups=collections.defaultdict(list)
    for q in questions:
        if q['caseGroupId']:groups[q['caseGroupId']].append(q)
    for group in groups.values():
        for i,q in enumerate(group):
            q.update(caseOrder=i+1,caseGroupSize=len(group),caseGroupTitle='历年材料题')
    report={'sourceCount':len(sources),'sourceOccurrences':sum(s['extractedCount'] for s in sources),
            'questionCount':len(questions),'duplicateOccurrences':sum(s['extractedCount'] for s in sources)-len(questions),
            'heldCount':sum(q['reviewStatus']=='held' for q in questions),'unparsedCount':len(rejected),
            'bySubject':{s:dict(collections.Counter(q['type'] for q in questions if q['subjectId']==s)) for s in ['finance','law']},
            'mappingNotice':'教材页与知识点由文本相似度自动关联，供定位复习；尚未逐题人工确认，不作为答案核验结论。'}
    payload={'meta':report,'sources':sources,'questions':questions,'unparsed':rejected}
    (ROOT/'content/imported-exams.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
