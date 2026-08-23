# Техническое ревью `inbox-plan-v3.md`

Дата ревью: 2026-08-23  
Объект: `inbox-plan-v3.md`, 244 строки  
Вердикт: **NO-GO для реализации v3 в текущем виде; GO для ограниченного PoC после закрытия двух CRIT**.

## Сводка

| Severity | Количество |
|---|---:|
| CRIT | 2 |
| HIGH | 6 |
| MED | 6 |
| LOW | 0 |

Базовое направление выбрано здраво: не писать собственный омниканальный инбокс, использовать Chatwoot как агентский интерфейс, а заказ создавать только явным действием оператора. WhatsApp и эфиры разумно вынесены из первого запуска.

План, однако, пока нельзя запускать в разработку как production-архитектуру. В нём отсутствует доверенная авторизация формы, а жёсткое требование к мобильному входу и бренду не совместимо одновременно с выбранным клиентом, Community Edition и указанной стоимостью. Кроме того, неверно описан Human Agent, не подтверждена обработка Facebook-комментариев, не определён доступ к IGSID и нет исполнимого перехода Cloud → self-hosted.

## Критические находки

### CRIT-01 — У формы заказа нет доверенной серверной авторизации

**Строки:** 105–111, 118–120.

План предлагает опубликовать Apps Script веб-приложение «по ссылке» и идентифицировать агента собственным подписанным токеном. Не указано, кто и на основании какой аутентифицированной серверной сессии выпускает токен. Dashboard App получает `currentAgent` и контекст разговора как клиентский `postMessage`; это обычные данные в браузере/WebView, которые нельзя считать доказательством личности агента.

Документированный payload Chatwoot содержит `currentAgent`, но не подпись Chatwoot над payload. Поле `hmac_verified` относится к проверке личности контакта, а не к агенту или сообщению Dashboard App. У Dashboard Apps также нет встроенного механизма передачи секрета/подписанного agent assertion; запрос на такую возможность остаётся отдельной открытой feature request.

**Сценарий отказа:** публичный Apps Script endpoint или его клиентский вызов можно воспроизвести вне Chatwoot, подставить другого агента/разговор/клиента и создать либо изменить заказ. Статический секрет в URL не исправляет модель: он общий, попадает в историю/логи и не подтверждает конкретного агента. Проверка только `event.origin` защищает канал `postMessage`, но не серверную операцию записи.

**Что требуется:**

1. Считать Dashboard App и весь его payload недоверенным клиентом.
2. Добавить серверный auth broker либо безопасный вход агента в саму форму. Broker должен выпускать короткоживущие claims минимум с `account_id`, `agent_id`, `conversation_id`, `inbox_id`, `exp`, `jti`; сервер записи должен проверять подпись, срок, одноразовость и полномочия агента.
3. Если выбран server-side broker, он должен независимо получать/проверять разговор и назначение через Chatwoot API или self-hosted БД, а не верить присланному клиентом `currentAgent`.
4. Публичный Apps Script не должен принимать запись только по знанию URL. Секреты нельзя помещать в Dashboard App URL или JS.
5. Для каждой записи журналировать доказанную сервером личность агента, а не отображаемое имя из `postMessage`.

До появления и проверки этой цепочки нельзя подключать форму к боевой таблице.

Источники: [Dashboard Apps: payload и `currentAgent`](https://www.chatwoot.com/hc/user-guide/articles/1677691702-how-to-use-dashboard-apps), [открытый запрос Chatwoot на аутентификацию Dashboard App](https://github.com/chatwoot/chatwoot/issues/8552).

### CRIT-02 — Жёсткое требование к клиенту/бренду не согласовано с лицензией и мобильным способом работы

**Строки:** 33–34, 44–45, 90–103, 132–148.

План одновременно рассчитывает на:

- привычную собственную иконку, домен и бренд;
- официальный мобильный Chatwoot или мобильный Safari;
- self-hosted Community Edition за $0;
- официальное удаление брендинга.

Эти условия не образуют один готовый вариант. Официальное мобильное приложение остаётся приложением Chatwoot. Для собственного имени/иконки нужен отдельный custom mobile build, Firebase-конфигурация, подпись и сопровождение iOS/Android сборки. На серверной стороне официальный прайс прямо указывает, что **Custom Branding не входит в Community Edition**; он входит в self-hosted Premium Support за $19/агент/месяц при годовой оплате. Самостоятельный форк/патч возможен как отдельная разработка, но это уже не «без своего кода» и обновления `cwctl` не поддерживают кастомизации автоматически.

Cloud Startups стоит $19/агент/месяц при годовой оплате и включает Dashboard Apps, но удаление брендинга доступно только Cloud Enterprise. Следовательно, таблица «CE $0 + свой логотип» и вывод «self-hosted одновременно дешевле и полностью выполняет требование №4» неверны.

**Что требуется:** до следующих фаз выбрать ровно один production-клиент:

| Вариант | Собственный бренд/иконка | Push | Стоимость и трудоёмкость |
|---|---|---|---|
| Cloud Startups + официальный Chatwoot app | Нет | Готов | Самый быстрый пилот; $57/мес при годовой оплате |
| Self-hosted + официальный Chatwoot app | Частично: свой серверный домен, но app Chatwoot | Готов через relay | CE + инфраструктура; требование к иконе не выполнено |
| Self-hosted web/PWA с домашней иконкой | Потенциально да | Требует отдельного теста iOS PWA | Без native fork, но UX/фоновые push — отдельный гейт |
| Self-hosted + custom mobile build | Да | Свой Firebase/FCM | Отдельный мобильный продукт и постоянное сопровождение |
| Self-hosted Premium Support | Серверный custom branding включён | Зависит от выбранного клиента | $57/мес + инфраструктура; не дешевле Cloud Startups по лицензии |

Если требование №4 действительно не обсуждается, текущий вариант с официальным native app не проходит. Если бренд можно ослабить для операторов, Cloud Startups — намного более короткий и менее рискованный первый запуск.

Источники: [Cloud pricing и включённые Dashboard Apps](https://www.chatwoot.com/pricing), [self-hosted pricing и Custom Branding](https://www.chatwoot.com/pricing/self-hosted-plans), [официальная инструкция custom mobile build](https://developers.chatwoot.com/self-hosted/custom-mobile-app), [оговорка Chatwoot об обновлении кастомизированной установки](https://developers.chatwoot.com/self-hosted/deployment/backup).

## Высокий риск

### HIGH-01 — Facebook-комментарии включены в фазу 1 как функция, которой у Chatwoot не подтверждено

**Строки:** 27, 67, 114–116.

План обещает «FB-комментарии → private reply в Messenger» средствами Chatwoot. Официальная документация Facebook channel описывает только личные сообщения страницы. В официальном репозитории Chatwoot поддержка Facebook post comments долго остаётся feature request; представитель проекта предлагал отдельный инструмент, который переводит комментатора в DM. Текущая продуктовая страница каналов также заявляет Facebook Messenger, но не управление публичными комментариями.

Это не косметическое расхождение: часть заявленных 15% обращений не попадёт в единый инбокс автоматически.

**Исправление:** убрать комментарии из обещаний фазы 1 либо добавить отдельный официальный Meta-интеграционный трек с нужными comment/private-reply endpoints, permissions, webhook-полями, дедупликацией и собственным App Review. До решения измерить отдельно долю Messenger DM и долю комментариев; текущие 15% нельзя считать полностью покрытыми.

Источник: [официальное обсуждение Chatwoot о Facebook post comments](https://github.com/chatwoot/chatwoot/discussions/8455), [документация Facebook inbox Chatwoot](https://www.chatwoot.com/hc/user-guide/en/categories/other-channels).

### HIGH-02 — IGSID выбран ключом до доказательства, что он доступен Dashboard App и имеет заявленную область стабильности

**Строки:** 118–120, 186–189, 225, 228–229.

Документированный payload Dashboard App содержит `conversation.id`, `inbox_id`, объект `contact` и nullable `contact.identifier`. Он **не документирует** `contact_inbox.source_id` как часть стабильного контракта Dashboard App. В модели Chatwoot внешний channel identifier хранится именно на связи ContactInbox; `contact.identifier` — отдельное поле и для social contact может быть `null`. Поэтому формула «Dashboard App получает IGSID → форма использует его как ключ» пока не реализуема по документированному контракту.

Утверждение «IGSID стабилен только в пределах приложения» также не подкреплено указанным источником. Актуальная документация Meta описывает IGSID как идентификатор пользователя, полученный из messaging webhook для взаимодействия с Instagram Professional account; из этого нельзя автоматически вывести описанный в плане алгоритм миграции между приложениями.

**Исправление:**

- главным ключом клиента сделать собственный `customer_uuid`;
- внешнюю идентичность хранить отдельно как составной ключ `(provider, professional/page account или inbox, external_user_id)`;
- сохранять также `chatwoot_contact_id`, `conversation_id`, snapshot username и даты наблюдения, но не делать username ключом;
- из Dashboard App передавать документированные внутренние ID, а IGSID получать сервером через авторизованный Chatwoot API/БД;
- в PoC зафиксировать реальные payload web, iOS и PWA и доказать точное поле до начала интеграции Sheets.

Источники: [Dashboard App event payload](https://www.chatwoot.com/hc/user-guide/articles/1677691702-how-to-use-dashboard-apps), [модель Contact/ContactInbox Chatwoot](https://github.com/chatwoot/chatwoot/wiki/Building-on-Top-of-Chatwoot%3A-Importing-Existing-Contacts-and-Creating-Conversations), [официальная коллекция Meta: Instagram User Profile API и IGSID](https://www.postman.com/meta/instagram/folder/23987686-22b3a5b0-4a51-449a-9299-e3667d69b182).

### HIGH-03 — Аргумент Human Agent в развилке Cloud/self-hosted перевёрнут

**Строки:** 177–180.

В плане сказано: если Chatwoot не ставит Human Agent tag, на Cloud это не исправить, поэтому self-hosted предпочтительнее. Официальная документация Chatwoot говорит обратное: permission `HUMAN_AGENT` уже включён для Chatwoot Cloud, а self-hosted установка должна сама пройти App Review. В self-hosted конфигурации имеются отдельные флаги `ENABLE_MESSENGER_CHANNEL_HUMAN_AGENT` и `ENABLE_INSTAGRAM_CHANNEL_HUMAN_AGENT`; они требуют одобренного Meta app.

**Влияние:** один из главных аргументов в пользу self-hosted на самом деле является аргументом в пользу Cloud для быстрого запуска.

**Исправление:** переписать развилку. Для Cloud проверить живым тестом ответ на 25-м часу и на 6-м дне. Для self-hosted включать флаги только после одобрения `human_agent`, а этот permission считать отдельным release gate. Не смешивать Human Agent с маркетинговыми/автоматическими сообщениями: расширение предназначено для ответа человека.

Источники: [Human Agent в Chatwoot Cloud и self-hosted](https://www.chatwoot.com/hc/user-guide/articles/1745225158-what-is-human-agent-tag-in-instagram-messenger-channel), [self-hosted config Chatwoot](https://github.com/chatwoot/chatwoot/blob/develop/config/installation_config.yml).

### HIGH-04 — App Review описан неполным набором permissions и поставлен в неисполнимый порядок

**Строки:** 137, 148, 154–157, 226–227.

В таблице названы только `pages_messaging` и `instagram_manage_messages`. Для текущего Instagram Login официальный guide Chatwoot перечисляет `instagram_business_basic`, `instagram_business_manage_messages` и отдельно `human_agent`. Для legacy Instagram via Facebook Login guide перечисляет более широкий набор: `instagram_manage_messages`, `instagram_basic`, `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `business_management`, `pages_read_engagement`. Выбор зависит от зафиксированной версии Chatwoot и OAuth-flow; Facebook Messenger и Instagram нельзя сводить к двум permissions.

App Review нельзя надёжно «запустить параллельно» до готового демонстрационного окружения. Guide требует рабочий публичный dashboard, test credentials, пошаговые reviewer instructions, screencast входящих/исходящих сообщений, privacy/data-handling материалы и демонстрацию каждого permission. Business Verification помогает, но не заменяет эту готовность и не гарантирует срок.

**Исправление:**

1. Зафиксировать Chatwoot release и выбрать один Instagram integration flow.
2. Поднять production-like self-hosted staging с HTTPS и тестовыми данными.
3. Составить permission matrix отдельно для Instagram, Messenger, Human Agent и будущих comments.
4. Пройти тестовый сценарий в development mode.
5. Только затем подавать review; запуск self-hosted считать заблокированным до approvals.
6. Планировать итерации/rejection buffer, не обещать фиксированные «недели».

Источники: [актуальный Instagram App Review guide Chatwoot](https://developers.chatwoot.com/self-hosted/instagram-app-review), [legacy Instagram via Facebook Login permissions](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/instagram-channel-setup).

### HIGH-05 — Вывод «Cloud в США покрыт DPA + SCC и не является блокером» не установлен

**Строки:** 139–152.

Chatwoot подтверждает, что Cloud размещён в AWS US и что DPA доступны, но Terms формулируют это как возможность заключить DPA с **определёнными enterprise clients**. План выбирает Startups и не содержит полученного/подписанного DPA, перечня subprocessors, transfer mechanism или результата проверки retention/deletion/DSAR.

SCC — не автоматическая индульгенция. Европейская комиссия разъясняет необходимость определить применимый механизм и, при использовании SCC, оценить передачу и дополнительные меры в соответствующих случаях. Поэтому фраза «не является блокером» до проверки договора слишком категорична.

**Исправление:** до передачи реальных клиентских сообщений в Cloud письменно получить от Chatwoot применимый к выбранному тарифу DPA, приложения с subprocessors/локациями/мерами безопасности и основание международной передачи; согласовать с ответственным за GDPR. Cloud trial проводить на синтетических/тестовых аккаунтах, если договор ещё не закрыт. Включить Google Sheets/Apps Script и Meta в общую карту обработки, сроки хранения и процедуру удаления/экспорта.

Это техническо-организационный вывод, не юридическое заключение.

Источники: [Cloud hosting location и retention по тарифам](https://www.chatwoot.com/pricing), [Chatwoot Terms: GDPR DPA](https://www.chatwoot.com/terms-of-service), [разъяснение Еврокомиссии по SCC и transfer impact assessment](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/new-standard-contractual-clauses-questions-and-answers-overview_en).

### HIGH-06 — Рекомендованный переход Cloud → self-hosted не имеет миграционного механизма и rollback

**Строки:** 147–155, 186–192, 228–229.

План предлагает проверить Cloud и затем выйти в бой на self-hosted, но не определяет:

- как переносятся контакты, разговоры, сообщения, вложения и связи с заказами;
- как меняются Chatwoot `contact_id`, `conversation_id`, `inbox_id` и OAuth/app context;
- можно ли одновременно держать webhook/channel connection в двух системах без дублей или потерь;
- окно заморозки, RPO, критерий rollback и обработку сообщений, пришедших во время cutover;
- что увидит оператор в старой и новой истории.

Chatwoot документирует export через API для Cloud и backup/restore для собственной инсталляции, но это не равно документированному Cloud → self-hosted importer. Перенос self-hosted БД через `pg_dump` не применим к Cloud-аккаунту клиента.

**Исправление:** либо тестировать Cloud только на отдельном тестовом IG/FB окружении и не считать его источником production-истории, либо до пилота написать и прогнать отдельный migration/cutover runbook. Все заказы должны ссылаться на собственный `customer_uuid` и хранить origin IDs как атрибуты, чтобы смена Chatwoot instance не разорвала бизнес-историю.

Источники: [Cloud export через API](https://www.chatwoot.com/pricing), [backup/restore self-hosted](https://developers.chatwoot.com/self-hosted/deployment/backup), [перенос self-hosted базы](https://developers.chatwoot.com/self-hosted/runbooks/migrate-chatwoot-database).

## Средний риск

### MED-01 — Мобильный гейт проверяет видимость, но не контракт и производственный UX

**Строки:** 90–100, 118–120, 221.

Dashboard Apps уже представлены в мобильном клиенте, поэтому вопрос «отображаются ли вообще» устарел как единственный критерий. В официальных issue зафиксированы более тонкие отказы: отсутствие context payload на iOS в одной версии и различие snake_case/camelCase между web и mobile. Закрытый issue не является гарантией для произвольной пары версий server/mobile.

**Исправление:** превратить Gate 1 в acceptance matrix на физических iPhone для зафиксированных версий:

- официальный iOS app, mobile Safari и установленная PWA — только те варианты, которые реально рассматриваются;
- загрузка Dashboard App после cold start, foreground/background и перехода между разговорами;
- точные поля и типы payload, повторный `fetch-info`, защита от stale context;
- авторизация формы, клавиатура, narrow layout, поворот, double tap;
- push → deep link → правильный разговор → правильный клиент формы;
- плохая сеть, повтор запроса, истёкшая сессия, обновление app/server;
- минимум 30–50 реальных тестовых разговоров тремя агентами в пиковом сценарии.

Источники: [iOS context bug](https://github.com/chatwoot/chatwoot-mobile-app/issues/906), [различие payload web/mobile](https://github.com/chatwoot/chatwoot/issues/11071), [mobile app capabilities](https://www.chatwoot.com/mobile-apps).

### MED-02 — LockService не даёт идемпотентность отправки формы и не определяет атомарность резерва

**Строки:** 20, 76–81, 183–185.

Идемпотентность обсуждается только применительно к отвергнутому `message_created`. Боевой риск находится в явной форме: двойной tap на iPhone, retry после timeout, повтор после возврата из background или одновременное открытие одного разговора двумя агентами. LockService сериализует исполнения, но сам по себе не распознаёт повтор того же бизнес-запроса.

**Исправление:** генерировать уникальный `order_submission_id` до отправки, сохранять его в той же критической секции, возвращать ранее созданный заказ на повтор, а резервирование остатков и создание строки выполнять как одну бизнес-транзакцию/компенсируемую операцию. Не использовать один `conversation_id` как dedupe key: клиент может сделать несколько заказов в одном разговоре. Добавить явные состояния `creating/created/invoice_failed/cancelled` и безопасный retry downstream-пайплайна.

### MED-03 — Self-hosted стоимость считает VM, но не production-сервис

**Строки:** 132–148.

Официальный минимум Chatwoot — 2 CPU, 4 GB RAM и 20 GB SSD; рекомендация для production — 4+ CPU, 8+ GB RAM, 50+ GB SSD. Требуются PostgreSQL, Redis, worker, reverse proxy, SMTP; для вложений рекомендуется object storage. Backup должен покрывать БД, storage, env/secrets и кастомизации и храниться отдельно. В €10–15 не включены off-site backup, object storage, мониторинг/алерты, SMTP, домен, тест восстановления, обновления, App Review и труд администратора. При Premium branding добавляются те же $57/мес лицензии.

**Исправление:** считать трёхлетний TCO и определить владельца эксплуатации, RPO/RTO, patch cadence, мониторинг очередей/диска/БД/Redis/Sidekiq, шифрованный backup и регулярный restore drill. Сравнивать Cloud не с ценой VM, а с полной стоимостью сервиса.

Источники: [self-hosted requirements](https://developers.chatwoot.com/self-hosted), [подробные требования к ресурсам](https://developers.chatwoot.com/self-hosted/deployment/requirements), [backup scope](https://developers.chatwoot.com/self-hosted/deployment/backup), [object storage recommendation](https://developers.chatwoot.com/self-hosted/deployment/storage/supported-providers).

### MED-04 — Таймер окна не заменяет контроль фактической доставки

**Строки:** 177–182.

План фокусируется на видимом таймере, но production-контроль должен опираться на серверное `can_reply`, status/error исходящего сообщения и очередь исключений. Даже внутри окна отправка может упасть из-за token revocation, permission/API version changes, unsupported attachment или provider outage. Для Instagram Chatwoot документирует `sent/read/failed`, но не отдельный `delivered`.

**Исправление:** добавить acceptance test на 23/25 часов и 6/8 дней, UI-индикацию невозможности ответа, ежедневную очередь failed/undelivered, алерт по всплеску ошибок и runbook reauthorization/fallback. Успех нажатия Send нельзя считать доставкой заказа/подтверждения.

Источники: [Chatwoot message statuses по каналам](https://developers.chatwoot.com/self-hosted/message-statuses), [ограничения outbound по каналам](https://developers.chatwoot.com/self-hosted/supported-features).

### MED-05 — «Склейка контактов» не имеет правила доказательства личности

**Строки:** 190–191.

IG и FB действительно создают разные channel identities, но автоматическая склейка по имени/username создаёт риск объединить разных людей; ручная склейка без протокола оставляет тот же риск и плохо аудируется. Обратная проблема — один человек может менять username или использовать несколько профилей.

**Исправление:** хранить channel identities отдельно и связывать их с `customer_uuid` только после подтверждённого общего атрибута: номер/OTP, email link, существующий номер заказа плюс дополнительная проверка или явное подтверждение оператором по утверждённой процедуре. Сохранять автора, время, основание merge и поддерживать undo. Не использовать display name/username как единственное доказательство.

### MED-06 — «Экспорт истории» не определён как управляемый lifecycle данных

**Строки:** 168–169, 192.

Периодическая выгрузка без RPO, состава, проверки восстановления и политики удаления не снимает vendor lock-in. Она создаёт ещё одну копию персональных данных. Cloud Startups имеет retention один год; ссылки на внешние media могут истекать, а экспорт сообщений без вложений и identity mapping недостаточен.

**Исправление:** определить состав экспорта (contacts, contact inbox identities, conversations, messages, attachments, agents, labels, orders mapping), частоту/RPO, контроль полноты, шифрование, доступ, retention и каскадное удаление. Раз в квартал проверять восстановление выборки в независимое представление, а не только успешность job.

Источники: [Cloud retention и API export](https://www.chatwoot.com/pricing), [Chatwoot backup data set как ориентир полноты](https://developers.chatwoot.com/self-hosted/deployment/backup).

## Ответы на вопросы раздела 10

### 1. Выдерживает ли схема мобильную работу

Потенциально да, но не в текущей неопределённой форме. Dashboard Apps существуют в native mobile, однако это не гарантирует совместимый payload и удобную форму на конкретной версии iOS. Главный выбор — не «видна ли панель», а какой клиент является продуктом: официальный Chatwoot app, PWA или собственная mobile build. Только PWA/custom build могут претендовать на строгое выполнение собственного бренда/иконки; оба требуют отдельного end-to-end gate.

### 2. Верен ли отказ от собственного фронтенда инбокса

Да. При трёх операторах и примерно 2000 разговорах/месяц создание собственного inbox frontend не оправдано: придётся воспроизвести real-time sync, assignment, unread, вложения, delivery states, provider policy windows, reconnect и мобильные push. Следует писать только безопасное приложение заказа и минимальный auth/integration backend.

### 3. Правильно ли расставлены веса Cloud vs self-hosted

Нет.

- Dashboard Apps входят в Cloud Startups; Gate 2 уже подтверждается публичным прайсом.
- Human Agent для Cloud уже enabled, а для self-hosted требует собственного App Review.
- Community Edition официально не включает custom branding.
- Self-hosted Premium branding стоит те же $19 × 3, что Cloud Startups, плюс инфраструктура и эксплуатация.
- Cloud production требует письменного подтверждения DPA/transfer setup для выбранного тарифа.

Рациональный быстрый пилот — Cloud с тестовыми данными и ослабленным брендом. Рациональный production при действительно жёстком бренде/локализации — self-hosted после отдельного выбора PWA/custom app, безопасного auth broker и App Review. Смешанный путь «немного Cloud, затем легко переедем» — самый рискованный без миграционного проекта.

### 4. Какие скрытые допущения остались в iframe/Apps Script

Главные: отсутствующая серверная аутентификация, недоверенный `postMessage`, неясный источник IGSID, различия mobile/web payload, third-party cookie/login, stale conversation context при переключении, повторная отправка формы, clickjacking/origin checks и отсутствие транзакционной идемпотентности. Сам `ALLOWALL` решает лишь запрет фрейминга и одновременно расширяет поверхность clickjacking; он не решает ни одну из этих задач.

### 5. Что упущено полностью

Facebook comments/private reply, production-клиент и его бренд, secure identity chain агента, полный App Review scope, Cloud→self-hosted cutover/rollback, GDPR-договорная проверка, полная стоимость эксплуатации, delivery-failure workflow и управляемый lifecycle экспортированных данных.

## Рекомендуемая последовательность v4

1. **Decision Gate 0 — уточнить неизменяемость требования №4.** Если официальный Chatwoot app допустим для пилота, зафиксировать это как временное исключение. Если нет — выбрать PWA или custom mobile build и включить её стоимость.
2. **Security Gate — спроектировать auth broker.** До UI-работ доказать server-verifiable agent identity, authorization на conversation и idempotent order write.
3. **Identity Gate — зафиксировать data model.** `customer_uuid` + отдельные channel identities; снять реальные Dashboard App payload на web/iOS/PWA.
4. **Channel Gate — Cloud test tenant с синтетическими данными.** Проверить Instagram DM, story reply/mention, Messenger DM, текст/фото/видео/voice/file, read/failed, 23/25 ч и 6/8 дней. Facebook comments считать отдельным тестом/интеграцией.
5. **Mobile Gate — полный сценарий трёх агентов на физических iPhone.** Включить push/deep link, смену разговоров, фон, сеть и double submit.
6. **Hosting decision.** Пересчитать Cloud Startups/Enterprise, self-hosted CE/Premium и custom app как четыре разных варианта; получить DPA либо утвердить EU self-hosted.
7. **Если self-hosted — production-like staging и App Review.** Зафиксировать Chatwoot release/OAuth flow, permissions, screencasts, тестовые credentials, Human Agent.
8. **Migration/cutover rehearsal.** Или явно отказаться от переноса тестовой Cloud-истории, или прогнать экспорт, identity mapping, webhook cutover и rollback.
9. **Pilot без собственного inbox frontend.** 1 оператор → 3 оператора, затем пик коллекции; измерять время заказа, дубли, failed messages, неверный клиент, latency и ручные возвраты в native apps.

## Критерий GO

Переход к production допустим, когда одновременно выполнены следующие условия:

- сервер может доказать агента и его право на conversation без доверия к клиентскому payload;
- выбран один мобильный production-клиент, явно выполняющий согласованную версию требования №4;
- подтверждён точный identity field и внедрён собственный `customer_uuid`;
- Instagram/Messenger permissions и Human Agent одобрены для выбранного hosting path;
- Facebook comments либо исключены из scope/метрик, либо реально проходят E2E;
- форма идемпотентна, а резерв и downstream retry протестированы;
- закрыты DPA/transfer вопросы либо выбран EU self-hosted;
- выполнены backup/restore, monitoring, failed-message runbook и cutover rehearsal.

