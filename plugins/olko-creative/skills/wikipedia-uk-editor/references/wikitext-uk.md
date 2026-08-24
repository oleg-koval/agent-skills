# Ukrainian Wikipedia wikitext reference

All template and policy names below were verified against the live `uk.wikipedia.org` API. Anything not listed here must be checked with `./scripts/wiki.sh check uk "Шаблон:X"` before use.

## Policy pages and shortcuts

| Shortcut | Resolves to | Use |
|---|---|---|
| ВП:ЗН | Вікіпедія:Критерії значущості | Is the subject article-worthy at all |
| ВП:АД | Вікіпедія:Авторитетні джерела | Is this source usable |
| ВП:НТЗ | Вікіпедія:Нейтральна точка зору | Tone and framing |
| ВП:ОД | Вікіпедія:Жодних оригінальних досліджень | No synthesis or personal analysis |
| ВП:КОПІВІО | Вікіпедія:Авторські права | Copyright — never paste source prose |

Note the spelling: **значущості**, not «значимості» (that title is a redirect).

## Citation templates (verified)

```wikitext
<ref>{{Cite web |url=https://example.com/article |title=Заголовок джерела |website=Назва видання |date=2024-03-12 |accessdate=2026-07-27 |language=uk}}</ref>

<ref>{{Стаття |автор=Прізвище І. |назва=Назва статті |видання=Назва журналу |рік=2023 |том=12 |номер=4 |сторінки=15–28}}</ref>

<ref>{{Книга |автор=Прізвище І. |назва=Назва книги |видавництво=Видавництво |рік=2021 |сторінок=320 |isbn=978-0-00-000000-0}}</ref>
```

Named refs for repeated sources: `<ref name="bbc">{{Cite web |...}}</ref>` then `<ref name="bbc" />`.

The reference list goes under a `== Примітки ==` heading as `{{Reflist}}`.

## Maintenance templates (verified)

| Template | Meaning |
|---|---|
| `{{Без джерел}}` | Article has no sources (`Шаблон:Немає джерел` redirects here) |
| `{{Без виносок}}` | Sources listed but no inline refs |
| `{{Джерело}}` | Inline: this specific claim needs a citation |
| `{{Неавторитетне джерело}}` | Inline: cited source fails ВП:АД |
| `{{Уточнити}}` | Inline: vague or ambiguous statement |
| `{{Заготовка}}` | Stub (`Шаблон:Доробити` redirects here) |
| `{{Ізольована стаття}}` | No incoming links (`Шаблон:Сирота` redirects here) |
| `{{Не перекладено}}` | Red link with a link to the article in another language |
| `{{Перекладена стаття}}` | **Required attribution when translating** |
| `{{Особа}}` | Person infobox (there is no `Шаблон:Картка особи`) |

`{{Не перекладено|Український підпис|Український підпис|en|English Title}}` — use instead of a bare red link when the topic exists in another wiki.

## Translation attribution — mandatory

Wikipedia's licence requires attributing the source article. Place at the very end of the article, and also state it in the edit summary:

```wikitext
{{Перекладена стаття|en|English Article Title|<oldid of the revision translated>}}
```

Get the revision id with `./scripts/wiki.sh revid en "English Article Title"`.

Edit summary for a translation:
`Переклад статті [[:en:English Article Title]] (версія 1234567890) з англійської Вікіпедії; додано джерела`

## Article skeleton

```wikitext
{{Особа
| ім'я             = Повне ім'я
| оригінал імені   = Full Name
| зображення       =
| дата народження  = 12.03.1980
| місце народження = [[Київ]]
| громадянство     = {{Прапорець|Україна}}
| діяльність       = фотограф, підприємець
| сайт             = https://example.com
}}

'''Повне ім'я''' (нар. 12 березня 1980, [[Київ]]) — український фотограф.<ref>{{Cite web |...}}</ref>

== Біографія ==
Текст із виносками.<ref name="src1" />

== Творчість ==

== Примітки ==
{{Reflist}}

== Посилання ==
* [https://example.com Офіційний сайт]

[[Категорія:Народились 1980]]
[[Категорія:Українські фотографи]]

{{Перекладена стаття|en|Full Name|1234567890}}
```

The bolded subject name must appear in the first sentence. Lead paragraph = definition + why notable, both sourced.

`{{Особа}}` auto-fills from Wikidata: if the subject has a Wikidata item, a bare `{{Особа}}` is often enough, and you only pass parameters that should differ from Wikidata. Dates in this infobox are plain `дд.мм.рррр` — **do not** wrap them in `{{Дата народження}}`. The template auto-adds `Категорія:Персоналії за алфавітом`, so do not add it manually.

## Common section headings (Ukrainian, sentence case)

`Історія`, `Біографія`, `Кар'єра`, `Опис`, `Характеристики`, `Технічні характеристики`, `Застосування`, `Критика`, `Нагороди`, `Див. також`, `Примітки`, `Джерела`, `Посилання`.

Order at the end is fixed: `Див. також` → `Примітки` → `Джерела` → `Посилання` → categories.

## Localisation traps

- Dates in prose: `12 березня 2024 року`. Never `03/12/2024`.
- Decimal separator is a comma: `3,14`. Thousands separated by a non-breaking space.
- Transliterate names into Ukrainian and give the original in brackets on first mention: `Джон Сміт (англ. John Smith)`.
- Ukrainian apostrophe is `'` in `ім'я`, `кар'єра`, `п'ять`.
- Use `и`/`і` correctly in loanwords — «дизайн», «інтерфейс», «Гуглу» declines.
- Interwiki links are managed in Wikidata, not in the article. Do not add `[[en:...]]`.

## Categories

Categories must already exist or the article lands in a red category. Check with:

```sh
./scripts/wiki.sh check uk "Категорія:Українські фотографи"
```

Real backlog categories worth mining (verified): `Категорія:Незавершені статті` (~4 450 pages), `Категорія:Статті без джерел` (181 subcategories by year/month).
