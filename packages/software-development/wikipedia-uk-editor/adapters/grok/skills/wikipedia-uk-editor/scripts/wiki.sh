#!/bin/sh
# Read-only MediaWiki API helper for the wikipedia-uk-editor skill.
# This script NEVER writes to a wiki. It has no auth and no action=edit path.
#
# Usage:
#   wiki.sh get      <lang> <title>          raw wikitext of a page
#   wiki.sh check    <lang> <title>          does the page exist (follows redirects)
#   wiki.sh revid    <lang> <title>          latest revision id (for {{Перекладена стаття}})
#   wiki.sh langlink <lang> <title> <target> title of the same topic in <target> wiki, if any
#   wiki.sh search   <lang> <query> [n]      search article titles
#   wiki.sh backlog  <category> [n]          list pages in a uk category (maintenance backlogs)
#   wiki.sh info     <lang> <title>          length, last edit, categories, templates used
#   wiki.sh tasks    <type> [n]              candidate articles for a newcomer task type
set -eu

UA="wikipedia-uk-editor-skill/1.0 (https://github.com/oleg-koval/agent-skills)"

api() {
  lang=$1
  shift
  curl -sfA "$UA" --get "https://${lang}.wikipedia.org/w/api.php" \
    --data-urlencode "format=json" --data-urlencode "formatversion=2" "$@"
}

jqp() { python3 -c "$1"; }

cmd=${1:-}
[ -n "$cmd" ] || { sed -n '2,13p' "$0"; exit 1; }
shift

case "$cmd" in
  get)
    api "$1" --data-urlencode "action=parse" --data-urlencode "page=$2" \
        --data-urlencode "prop=wikitext" --data-urlencode "redirects=1" |
      jqp "import json,sys
d=json.load(sys.stdin)
if 'error' in d: sys.exit('NOT FOUND: '+d['error'].get('info',''))
print(d['parse']['wikitext'])"
    ;;
  check)
    api "$1" --data-urlencode "action=query" --data-urlencode "titles=$2" \
        --data-urlencode "redirects=1" |
      jqp "import json,sys
q=json.load(sys.stdin)['query']
for r in q.get('redirects',[]): print('REDIRECT:',r['from'],'->',r['to'])
for p in q['pages']: print(('MISSING ' if p.get('missing') else 'EXISTS  ')+p['title'])"
    ;;
  revid)
    api "$1" --data-urlencode "action=query" --data-urlencode "titles=$2" \
        --data-urlencode "prop=revisions" --data-urlencode "rvprop=ids|timestamp" \
        --data-urlencode "redirects=1" |
      jqp "import json,sys
p=json.load(sys.stdin)['query']['pages'][0]
if p.get('missing'): sys.exit('MISSING: '+p['title'])
r=p['revisions'][0]
print(p['title'], r['revid'], r['timestamp'])"
    ;;
  langlink)
    api "$1" --data-urlencode "action=query" --data-urlencode "titles=$2" \
        --data-urlencode "prop=langlinks" --data-urlencode "lllang=$3" \
        --data-urlencode "lllimit=500" --data-urlencode "redirects=1" |
      jqp "import json,sys
p=json.load(sys.stdin)['query']['pages'][0]
if p.get('missing'): sys.exit('MISSING: '+p['title'])
ll=p.get('langlinks')
print(ll[0]['title'] if ll else 'NO EQUIVALENT — safe to create')"
    ;;
  search)
    api "$1" --data-urlencode "action=query" --data-urlencode "list=search" \
        --data-urlencode "srsearch=$2" --data-urlencode "srlimit=${3:-10}" |
      jqp "import json,sys
for r in json.load(sys.stdin)['query']['search']:
    print(f\"{r['size']:>8}B  {r['title']}\")"
    ;;
  backlog)
    api uk --data-urlencode "action=query" --data-urlencode "list=categorymembers" \
        --data-urlencode "cmtitle=$1" --data-urlencode "cmlimit=${2:-20}" |
      jqp "import json,sys
d=json.load(sys.stdin)
if 'error' in d: sys.exit('NOT FOUND: '+d['error'].get('info',''))
for m in d['query']['categorymembers']: print(m['title'])"
    ;;
  info)
    api "$1" --data-urlencode "action=query" --data-urlencode "titles=$2" \
        --data-urlencode "prop=info|categories|templates" --data-urlencode "cllimit=50" \
        --data-urlencode "tllimit=50" --data-urlencode "redirects=1" |
      jqp "import json,sys
p=json.load(sys.stdin)['query']['pages'][0]
if p.get('missing'): sys.exit('MISSING: '+p['title'])
print('title  :',p['title'])
print('length :',p.get('length'),'bytes')
print('touched:',p.get('touched'))
print('cats   :', ', '.join(c['title'] for c in p.get('categories',[])) or '(none)')
print('tmpls  :', ', '.join(t['title'] for t in p.get('templates',[])) or '(none)')"
    ;;
  tasks)
    type=${1:-}
    n=${2:-20}
    case "$type" in
      copyedit)   templates="Шаблон:Мовні помилки" ;;
      links)      templates="Шаблон:Упорядкувати|Шаблон:Брак посилань" ;;
      references) templates="Шаблон:Без джерел" ;;
      update)     templates="Шаблон:Оновити" ;;
      expand)     templates="Шаблон:Доробити" ;;
      *)
        echo "Unknown task type: '$type'. Valid types: copyedit, links, references, update, expand" >&2
        exit 1
        ;;
    esac
    oldifs=$IFS
    IFS='|'
    for tmpl in $templates; do
      IFS=$oldifs
      echo "== $tmpl =="
      api uk --data-urlencode "action=query" --data-urlencode "list=embeddedin" \
          --data-urlencode "eititle=$tmpl" --data-urlencode "einamespace=0" \
          --data-urlencode "eilimit=$n" |
        jqp "import json,sys
d=json.load(sys.stdin)
if 'error' in d: sys.exit('NOT FOUND: '+d['error'].get('info',''))
for m in d['query']['embeddedin']: print(m['title'])"
    done
    ;;
  *)
    sed -n '2,13p' "$0"; exit 1
    ;;
esac
