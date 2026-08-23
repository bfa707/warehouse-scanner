# Техническое ревью `inbox-plan-v4.md`

Дата ревью: 2026-08-23  
Объект: `inbox-plan-v4.md`, 263 строки  
Дополнительно проверены: текущий лаунчер `sklad/index.html` и его manifest  
Вердикт: **NO-GO для production-реализации v4; GO для ограниченного PoC после фиксации same-origin архитектуры.**

## Сводка

| Severity | Количество |
|---|---:|
| CRIT | 2 |
| HIGH | 5 |
| MED | 6 |
| LOW | 0 |

v4 существенно лучше v3: владелец зафиксировал продуктовые ограничения, отказался от снятия брендинга, правильно развернул аргумент про Human Agent, вынес мобильные допущения в гейты, признал отсутствие Facebook-комментариев и сделал `customer_uuid` главным внутренним ключом.

Тем не менее целевая схема пока не готова к разработке как production-архитектура. К старому CRIT по авторизации добавился второй блокер, обнаруженный при проверке реального лаунчера: Chatwoot по умолчанию запрещает cross-origin iframe через `X-Frame-Options: SAMEORIGIN`, а текущий лаунчер именно так и работает. Пуши установленной iOS web app также принадлежат origin верхней страницы, тогда как в плане Chatwoot находится во вложенном origin. Оба ограничения можно потенциально снять одной архитектурой — перенести лаунчер на тот же origin, что и Chatwoot, — но это нужно доказать физическим PoC на iPhone до App Review и интеграции с боевой таблицей.

## Что изменилось относительно ревью v3

| Замечание v3 | Статус в v4 | Комментарий |
|---|---|---|
| Авторизация Dashboard App | Открыто | Проблема верно признана CRIT, но решения всё ещё нет. |
| Брендинг CE и одна иконка | Частично закрыто | Платное снятие бренда больше не требуется; технический способ сохранить одну иконку не доказан. |
| Human Agent был истолкован наоборот | Закрыто | Теперь верно указан как дополнительный риск self-hosted. |
| Facebook comments считались частью покрытия | Частично закрыто | Ограничение признано, но его бизнес-влияние не измерено. |
| IGSID как главный ключ | Закрыто концептуально | Выбран `customer_uuid`; серверный способ извлечения внешнего ID всё ещё надо определить. |
| Неполный App Review | Существенно улучшено | Порядок действий корректнее; не зафиксированы release/flow, permission matrix и календарный резерв. |
| Cloud → self-hosted migration | Закрыто | Cloud больше не предлагается как боевой пилот с последующей миграцией. |
| Идемпотентность формы | Частично закрыто | Риск назван, но контракт и состояния не определены. |
| Production TCO и эксплуатация | Частично закрыто | Статьи названы, но суммы, SLO, RPO/RTO и ответственный отсутствуют. |
| GDPR/data lifecycle | Открыто | В v4 этот контур практически исчез. |

## Критические находки

### CRIT-01 — у формы по-прежнему нет доверенной серверной авторизации

**Строки:** 106–127.

Диагноз v4 верный: `currentAgent`, `conversation` и `contact` приходят через клиентский `postMessage` и не доказывают, кто отправляет запись. Документированный Dashboard App payload действительно содержит `currentAgent`, но Chatwoot не подписывает этот объект для доверенной серверной проверки. Доступ к собственной БД и сессиям Chatwoot не решает проблему автоматически: Apps Script iframe находится на другом origin и не получает аутентификацию родительского интерфейса из-за Same Origin Policy.

Публичный Apps Script может быть безопасным только в смысле «страница открывается всем»; операция записи всё равно обязана требовать отдельное доказательство полномочий. Нельзя использовать как это доказательство URL приложения, общий секрет в JS/URL, отображаемое имя агента, `event.origin` или поле `hmac_verified` контакта.

**Минимально достаточная схема для трёх сотрудников:**

1. Выдать каждому агенту отдельный случайный bearer credential не менее 128 бит; лучше отдельный credential на устройство. Сохранить на сервере только hash, agent mapping, дату выдачи и статус отзыва.
2. Один раз ввести credential в форме на конкретном iPhone; хранить его в storage origin формы. Не встраивать credential в URL или исходный код.
3. Каждая запись передаёт credential, случайный `order_submission_id`, `conversation_id`, `inbox_id` и данные заказа.
4. Сервер Apps Script или небольшой companion service сначала аутентифицирует credential и проверяет, что агент активен.
5. Серверным Chatwoot API token проверить существование разговора, нужные account/inbox и при выбранной политике — membership/assignee. Присланным из браузера данным о клиенте и агенте не доверять.
6. В одной критической секции проверить уникальность `order_submission_id`, создать заказ и сохранить audit record: доказанный `agent_id`, conversation, время, request ID и результат.
7. Добавить revoke/rotate, rate limit и процедуру увольнения/утраты телефона.

**Чем платим:** long-lived bearer credential не доказывает, что в момент отправки открыта настоящая сессия Chatwoot; украденный token действует до отзыва. Для трёх внутренних сотрудников, управляемых устройств и не-платёжной операции это может быть соразмерным риском, но только после явного принятия threat model.

Следующий уровень защиты — собственный логин формы с короткой 8–12-часовой opaque session либо OIDC; он не зависит от third-party cookies, но добавляет login UX и серверное состояние. Полный broker с подписанным assertion от активной сессии Chatwoot нужен только если требуется криптографически связать агента, текущий разговор и короткий срок действия. Для него придётся менять/расширять Chatwoot frontend/backend и постоянно переносить патч при обновлениях.

**Release gate:** до подключения к боевой Sheet нужно доказать негативными тестами, что запрос без credential, с отозванным credential, чужим разговором, повторным `order_submission_id` и подменённым `currentAgent` не создаёт заказ.

Источник: [документированный Dashboard App payload Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1677691702-how-to-use-dashboard-apps).

### CRIT-02 — текущий лаунчер не может встроить Chatwoot с другого origin по умолчанию

**Строки плана:** 31–32, 81–91, 147–151.  
**Фактический код:** `sklad/index.html`, строки 25–26 и 41–43.

Лаунчер сейчас не является multi-app shell. Это единственный iframe на весь экран с жёстко заданным URL Apps Script; меню «Сообщения», маршрутизации, жизненного цикла двух приложений и сохранения состояния в нём нет. Формулировка «дорабатывается под новый адрес» существенно занижает объём изменения.

Главное: ответы Chatwoot содержат `X-Frame-Options: SAMEORIGIN`. Если лаунчер остаётся на своём текущем origin, а Chatwoot поднимается на `https://inbox.example.lv`, браузер заблокирует интерфейс ещё до любых тестов клавиатуры и сессии. Совпадение только базового домена недостаточно: origin должен совпадать по scheme, host и port.

**Предпочтительный PoC:**

- разместить статический лаунчер на том же origin, что и Chatwoot, например `https://inbox.example.lv/launcher/`;
- отдать точный path лаунчера через Nginx, а остальные пути того же host направить в Chatwoot;
- поставить Home Screen web app именно с `start_url=/launcher/` и согласованным `scope`;
- внутри лаунчера грузить Chatwoot относительным URL того же origin и Apps Script как второй экран;
- проверить конфликт service worker/scope, логин, refresh, back navigation и deep links.

При таком варианте `SAMEORIGIN` не мешает и появляется шанс использовать push/badge Chatwoot в origin установленной web app. Альтернатива — удалить `X-Frame-Options` на reverse proxy и разрешить точный launcher origin через CSP `frame-ancestors`; она расширяет clickjacking surface и не решает origin-вопрос iOS push. Её нельзя принимать без отдельного security review.

**Release gate:** один физический iPhone должен пройти полный сценарий install → login → cold start → открыть склад → открыть Chatwoot → ответить → открыть Dashboard App → закрыть/вернуть из background, без Safari chrome и без потери сессии. Пока PoC не пройден, целевая архитектура не считается реализуемой.

Источники: [пример фактического `X-Frame-Options: SAMEORIGIN` у Chatwoot](https://github.com/orgs/chatwoot/discussions/11326), [issue Chatwoot о блокировке cross-origin iframe](https://github.com/chatwoot/chatwoot/issues/12082).

## Высокий риск

### HIGH-01 — текущий лаунчер не реализует iPhone Web Push, а вложенный Chatwoot не может считаться готовым решением

**Строки:** 133–145.

В репозитории есть manifest с `display: standalone`, но нет регистрации service worker, Push API, subscription storage или обработчика notification click. Manifest даёт полноэкранный запуск, но сам по себе не даёт фоновые уведомления.

iOS/iPadOS поддерживает Web Push для web app, добавленной на Home Screen, начиная с 16.4. Permission должен запрашиваться вследствие прямого действия пользователя; push работает через origin установленной web app. WebKit отдельно указывает, что badge из cross-origin frame не действует. Поэтому схема «верхний launcher origin → вложенный Chatwoot origin» не должна считаться совместимой с Chatwoot browser push без доказательства.

**Реалистичные пути:**

| Путь | Одна иконка | Цена |
|---|---:|---|
| Same-origin launcher + Chatwoot, использовать штатный browser push | Да | Лучший кандидат; всё равно нужен PoC на точной версии Chatwoot/iOS. |
| Launcher-owned Web Push через Chatwoot webhooks | Да | Свой service worker, VAPID, база subscriptions, маршрутизация по агентам, badge/deep links и мониторинг доставки. |
| Официальное native-приложение Chatwoot | Нет | Наиболее готовые push и deep links, но нарушает решение владельца. |
| Email как fallback | Формально да | Не гарантирует немедленное оповещение, зависит от Mail push/Focus; только аварийный канал. |
| Polling из фоновой PWA | Да | Неприемлем: iOS не гарантирует фоновое выполнение. |

**Acceptance Gate A:** на каждом рабочем iPhone установить web app, явно включить push, закрыть приложение, заблокировать экран, отправить assigned и unassigned сообщения, получить уведомление и badge, по tap открыть правильный разговор; повторить после 8+ часов background, перезагрузки телефона, смены сети и обновления web app. Отдельно проверить правила Chatwoot: уведомления зависят от назначения/участия и статуса разговора.

Источники: [Web Push для Home Screen web apps на iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [same-origin ограничение Badging API](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/), [настройка browser push в Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1731478912-setting-up-notifications), [условия доставки уведомлений Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1772103052-troubleshooting-why-am-i-not-receiving-notifications).

### HIGH-02 — App Review остаётся неоценённым критическим путём

**Строки:** 167–185.

Порядок подготовки в v4 правильный, но до оценки нельзя оставлять выбор «современный Instagram Login или legacy» открытым. Требуемые permissions, reviewer flow и набор тестов зависят от зафиксированной версии Chatwoot и способа подключения. `human_agent` должен демонстрироваться именно как ответ живого сотрудника, а не автоматизация или маркетинговая рассылка.

Meta не даёт пригодного для project commitment гарантированного SLA. Поэтому реалистичный диапазон здесь — оценка планирования, а не обещание платформы:

- **3–5 недель** от готового production-like стенда при чистом первом прохождении;
- **6–10 недель** как рабочий план с одной итерацией отказа/исправления;
- **10–12+ недель** как резерв для двух итераций, дополнительной проверки данных или нестабильного reviewer cycle.

В этот диапазон не входит разработка Chatwoot/launcher/auth до состояния, которое можно показать проверяющему. App Review нельзя подавать на макет: reviewer должен пройти реальный end-to-end flow.

Типичные причины отказа для этого сценария:

- use case или необходимость конкретного permission описаны слишком общо;
- screencast не показывает полный путь для каждого permission;
- тестовая учётная запись, URL, OAuth redirect или тестовая Page/IG account недоступны reviewer;
- заявлен один login flow, а сборка использует другой;
- privacy policy/data deletion page не соответствуют реальному сбору данных;
- `human_agent` выглядит как automation/продажа, а не ручная поддержка;
- reviewer не может воспроизвести входящее сообщение, ответ и получение ответа на стороне клиента.

**Исправление:** зафиксировать Chatwoot release, один Instagram flow и permission matrix до начала записи screencast; завести checklist доказательств отдельно на Instagram messaging, Facebook Messenger и Human Agent. Дата запуска не должна зависеть от единственной ожидаемой даты approval.

Источники: [актуальный Chatwoot Instagram App Review guide](https://developers.chatwoot.com/self-hosted/instagram-app-review), [legacy Instagram/Facebook setup](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/instagram-channel-setup), [Human Agent в Cloud и self-hosted](https://www.chatwoot.com/hc/user-guide/articles/1745225158-what-is-human-agent-tag-in-instagram-messenger-channel).

### HIGH-03 — Facebook comments возвращают второй рабочий inbox и могут отменить продуктовый смысл

**Строки:** 17–20, 196–203.

v4 честно признаёт ограничение. Актуальная feature discussion Chatwoot всё ещё описывает Facebook post comments как не реализованную штатную возможность; представитель проекта ранее рекомендовал отдельный инструмент для перевода комментариев в DM.

Проблема не в максимальных 15%, а в неизвестной доле внутри этих 15%. Если комментарии дают основную часть Facebook-заказов или приходят пиками во время выкладки коллекции, сотрудникам придётся постоянно следить за Business Suite. Тогда:

- нарушается требование одной иконки;
- исчезает гарантия единой очереди/unread;
- появляются пропуски и двойные ответы между двумя inbox;
- атрибуция заказа из комментария снова остаётся ручной.

**Исправление:** до любого платного этапа 14 дней измерять отдельно `FB Messenger DM`, `FB post comments`, сколько комментариев превращаются в заказ и сколько времени занимает их обработка. Не писать собственную comments-интеграцию до этого измерения: это новый inbox/channel frontend и отдельный App Review scope. Если доля значима, вариант Chatwoot не выполняет исходную цель «один рабочий вход».

Источник: [Facebook comments reply — feature request Chatwoot](https://github.com/chatwoot/chatwoot/discussions/8455).

### HIGH-04 — единственный экономический выигрыш не измерен

**Строки:** 99–102, 261–262.

Сам документ правильно формулирует, что Business Suite бесплатно закрывает омниканальность, назначение и доступ сотрудников. Значит, инвестиция покупает почти исключительно форму рядом с разговором. Для решения нет четырёх исходных чисел:

1. сколько из 2000 разговоров в месяц заканчиваются заказом;
2. сколько секунд сейчас занимает перенос одного заказа;
3. сколько времени форма действительно сэкономит на iPhone;
4. сколько стоят ошибки переноса, дубли и пропущенные позиции.

Иллюстрация чувствительности, не прогноз:

| Заказов/мес | Экономия на заказ | Экономия времени |
|---:|---:|---:|
| 400 | 30 секунд | 3,3 ч/мес |
| 600 | 60 секунд | 10 ч/мес |
| 1000 | 90 секунд | 25 ч/мес |

Даже 2000 разговоров не гарантируют большой ROI: важны заказы и разница времени между старым и новым процессом. В расчёт надо включить initial build, App Review, регулярную эксплуатацию и потерю времени при инцидентах.

**Исправление:** провести 7–14-дневный baseline и 30–50-заказный clickable prototype формы. Решение о self-hosted принимать по формуле:

`денежная экономия времени + стоимость предотвращённых ошибок > infra + ops + амортизированная разработка`.

До измерения ответ на вопрос «достаточен ли один выигрыш» — **не доказано**.

### HIGH-05 — self-hosted в ЕС не заменяет security/GDPR lifecycle

**Строки:** 15, 81–90, 173–177, 219–235.

EU-сервер уменьшает один риск международной передачи, но не определяет обработку данных целиком. Сообщения и идентичности проходят через Meta, хранятся в Chatwoot, попадают в Google Sheets/Apps Script, вложения и логи — в инфраструктуру/backup. В плане отсутствуют:

- роли controller/processor и перечень subprocessors;
- сроки хранения сообщений, вложений, заказов, логов и backup;
- единый delete/export flow по `customer_uuid`;
- доступы, MFA, offboarding и аудит действий администраторов;
- шифрование backup и секретов;
- incident response и уведомление об утечке;
- процедура удаления данных из Chatwoot, Sheets и будущих копий.

**Исправление:** до production создать data map и retention matrix, включить MFA Chatwoot, отдельные agent accounts, password manager/secrets, минимум прав, off-site encrypted backup и квартальный restore/delete drill. Privacy policy и data deletion page для Meta должны описывать реальную архитектуру, а не быть только формальностью App Review.

Это техническо-организационное замечание, не юридическое заключение.

Источники: [MFA для self-hosted Chatwoot](https://developers.chatwoot.com/self-hosted/configuration/multi-factor-authentication), [состав backup Chatwoot](https://developers.chatwoot.com/self-hosted/deployment/backup).

## Средний риск

### MED-01 — серверный источник внешней идентичности клиента не зафиксирован

**Строки:** 153–163.

`customer_uuid` — правильный главный ключ. Но документированный Dashboard App payload не гарантирует IGSID/PSID в нужной форме. `contact.identifier` nullable и не должен автоматически отождествляться с channel source ID.

Нужно зафиксировать server-side resolver:

`(chatwoot_account_id, inbox_id, contact_id/conversation_id) → (provider, channel_account, external_user_id) → customer_uuid`.

Получать external ID следует через поддерживаемый Chatwoot API; прямое чтение внутренней БД допустимо только как version-pinned fallback с контрактными тестами, иначе обновление Chatwoot может тихо сломать интеграцию. Username остаётся snapshot для показа, не ключом и не доказательством слияния клиентов.

### MED-02 — идемпотентность названа, но контракт операции не задан

**Строки:** 125–127.

LockService сериализует исполнения, но не распознаёт retry того же действия. Требуется:

- `order_submission_id` генерируется до первого submit и не меняется при retry;
- уникальность проверяется и записывается в той же блокировке, что и заказ;
- повтор возвращает уже созданный `order_id`, а не создаёт новый;
- состояния минимум `creating`, `created`, `invoice_failed`, `cancelled`;
- резервирование остатка и запись заказа имеют атомарную или компенсируемую семантику;
- два разных заказа из одного разговора имеют разные submission IDs;
- ответ формы различает timeout, rejected, duplicate и success.

### MED-03 — €15/мес реалистичны для VM, но не для production-сервиса целиком

**Строки:** 219–235.

Для нагрузки около 2000 разговоров/месяц один недорогой EU VM технически правдоподобен. Однако Chatwoot указывает 4 GB RAM как обязательный минимум, 4 CPU cores как рекомендуемый минимум и отдельные PostgreSQL, Redis и Sidekiq процессы. Размер диска зависит от вложений; backup должен покрывать БД, storage, конфигурацию и кастомизации и храниться отдельно.

Рабочий бюджет без труда владельца:

| Статья | Оценка/мес | Комментарий |
|---|---:|---|
| VM 4–8 GB | €10–20 | Конкретный тариф проверить на дату покупки. |
| Provider backup | +20% VM | У Hetzner семь backup slots; это не отменяет отдельную off-site копию. |
| Off-site storage/attachments | €3–10 | Зависит от объёма media и retention. |
| SMTP | €0–10 | Бесплатный tier возможен, но нужен мониторинг доставляемости. |
| Monitoring/domain | €1–10 | Бесплатные инструменты уменьшают деньги, но увеличивают труд. |
| **Итого cash** | **примерно €15–45** | Без разработки и рабочего времени владельца. |

Официальные рекомендации не подтверждают, что €15 — полный production TCO. Это только нижняя граница инфраструктуры.

Источники: [Chatwoot system requirements](https://developers.chatwoot.com/self-hosted/deployment/requirements), [Chatwoot backup requirements](https://developers.chatwoot.com/self-hosted/deployment/backup), [Hetzner: backup стоит 20% цены сервера](https://docs.hetzner.com/cloud/billing/faq/).

### MED-04 — нет эксплуатационного контракта, recovery и стратегии обновлений

**Строки:** 227–235.

Нужно заранее назначить владельца следующих задач: security updates, Chatwoot version pin, staging upgrade, миграции Postgres/pgvector, Redis/Sidekiq, SSL/domain, Meta token reauthorization, disk growth, backup, restore и алерты. Если для auth/embed понадобится изменение кода Chatwoot, официальный backup guide прямо предупреждает, что стандартные обновления предполагают отсутствие кастомизаций.

Минимальные production-цели для этого масштаба стоит записать явно:

- RPO не более 24 часов;
- RTO не более 4 рабочих часов;
- ежедневный backup DB/storage/config вне основного диска;
- ежемесячная проверка backup и квартальный полный restore drill;
- staging перед каждым upgrade и rollback runbook;
- алерты на 5xx, Sidekiq queue/failures, webhook errors, disk, DB, Redis, SSL и отсутствие входящих сообщений.

Оценка труда: обычно 2–4 часа владельца в спокойный месяц плюс отдельные окна на обновления; один сложный upgrade/incident легко занимает 4–12 часов. Это инженерная оценка, не гарантия.

Источники: [production Docker deployment и upgrade Chatwoot](https://developers.chatwoot.com/self-hosted/deployment/docker), [оговорка о custom code и backup](https://developers.chatwoot.com/self-hosted/deployment/backup).

### MED-05 — нет контроля доставки, reauthorization и coexistence с Meta Business Suite

**Строки:** 87, 94–97, 181–182, 189–203.

Открытое окно ответа не гарантирует успешную отправку. Сообщение может упасть из-за отозванного token, permission/version change, provider outage или неподдерживаемого media. Кроме того, при параллельной работе Business Suite и собственного Meta app нужно проверить routing/handover, чтобы входящие не пропадали и ответы не расходились между интерфейсами.

Нужны acceptance tests на 23/25 часов и 6/8 дней, очередь failed messages, видимая невозможность ответа, алерт на прекращение входящих событий, runbook reauthorization и правило, где оператор отвечает во время инцидента. Нажатие Send нельзя считать доказательством доставки.

### MED-06 — сравнение CE и Premium описывает Premium слишком узко

**Строки:** 230–247.

Актуальный self-hosted Premium стоит $19/agent/month при годовой оплате и включает не только custom branding, но также roles & permissions и priority support. При этом он не включает SSO/SAML и SLA policies — они относятся к Enterprise. Premium также не снимает App Review, iframe, push, auth, comments и операционные риски.

Для трёх агентов, принятого логотипа Chatwoot и простых ролей ценность Premium почти целиком сводится к priority support и необязательным дополнительным функциям. В таблице v5 нужно писать `$57/мес при годовой оплате + infra`, а не представлять сумму исключительно как плату за снятие логотипа.

Источник: [актуальный self-hosted pricing Chatwoot](https://www.chatwoot.com/pricing/self-hosted-plans).

## Разбор четырёх вариантов

Ниже сначала приведены плюсы и минусы каждого варианта; итоговая рекомендация — после сравнения.

### Вариант 1 — Meta Business Suite и ручной перенос

**Что выигрывается:**

- нулевая разработка, hosting и App Review;
- готовые native push, assignment и роли;
- Instagram Direct, Messenger и Facebook comments остаются в одном поддерживаемом Meta-интерфейсе;
- минимальный риск для Instagram account и нет нового operational owner;
- можно продолжать работать при любом сбое Chatwoot-проекта.

**Что теряется:**

- ник и состав заказа продолжают переноситься вручную;
- сохраняются ошибки, дубли и переключение между Business Suite и складом;
- буквальное требование одной иконки не выполняется: Business Suite остаётся вторым приложением.

**Скрытая цена:** часы ручного переноса и исправления ошибок. Она пока не измерена.

**Когда вариант перестаёт быть верным:** если baseline покажет устойчивую экономию не единиц, а десятков часов в месяц, существенные ошибки/потери заказов или невозможность выдерживать пики коллекций.

### Вариант 2 — Cloud Chatwoot

**Что выигрывается:**

- нет собственного сервера, backup, patching и собственного Meta App Review;
- самый короткий путь к реальному тесту Chatwoot, Dashboard Apps и agent UX;
- предсказуемые $57/мес при годовой оплате для трёх агентов;
- support/обновления платформы выполняет поставщик.

**Что теряется:**

- официальное мобильное приложение даёт вторую иконку;
- cross-origin embed Cloud в существующий launcher нельзя считать доступным: владелец не контролирует security headers и origin Cloud;
- Facebook comments не появляются;
- auth Dashboard App всё равно нужно решать отдельно;
- данные Cloud размещаются по модели поставщика, поэтому нужны DPA/transfer/retention проверки.

**Скрытая цена:** $684/год лицензии, форма/auth, возможная последующая миграция и договорная проверка данных.

**Когда вариант перестаёт быть верным:** уже сейчас, если одна собственная иконка действительно абсолютна. Он становится сильным вариантом только если владелец разрешит вторую иконку или отдельный top-level Chatwoot web client.

Источник цены: [Cloud pricing Chatwoot](https://www.chatwoot.com/pricing).

### Вариант 3 — self-hosted Community Edition

**Что выигрывается:**

- контроль origin позволяет потенциально выполнить одну иконку через same-origin launcher;
- данные Chatwoot можно хранить на выбранном EU-сервере;
- нет лицензионной платы за трёх агентов;
- серверный API и контролируемая инфраструктура упрощают проверку разговора и интеграцию с формой;
- можно независимо выбрать backup/retention и быстро отозвать доступ сотрудника.

**Что теряется:**

- собственный Meta app и неопределённый App Review;
- вся эксплуатация, security, backup, monitoring и incidents становятся обязанностью владельца;
- push, iframe/same-origin shell и auth требуют своей разработки/PoC;
- comments не покрыты;
- CE не даёт granular roles & permissions, SSO и priority support;
- кастомизация Chatwoot повышает стоимость обновлений.

**Скрытая цена:** ориентировочно €15–45/мес cash, 2–4 часа спокойной эксплуатации в месяц, 15–30 инженерных дней на production-ready первый запуск и календарный риск App Review. Диапазон разработки включает launcher/push PoC, auth/idempotency, deployment/hardening, Meta submission, mobile QA и cutover; он требует уточнения после PoC.

**Когда вариант перестаёт быть верным:** если same-origin push/launcher не проходят Gate A/B, comments дают значимую долю заказов, нет владельца эксплуатации или экономия ручного труда мала.

### Вариант 4 — self-hosted Premium Support

**Что выигрывается:**

- всё из self-hosted CE;
- priority support, custom branding и расширенные roles & permissions;
- меньше риск остаться без помощи на сложной проблеме продукта/upgrade.

**Что теряется:**

- $57/мес при годовой оплате добавляются поверх сервера;
- App Review, comments, push, launcher, auth, backup и incidents остаются;
- SSO и SLA policies не входят;
- снятие бренда не имеет ценности по уже принятому решению владельца.

**Скрытая цена:** примерно $684/год плюс полная стоимость CE-инфраструктуры и своей эксплуатации. Priority support не является гарантированным SLA.

**Когда вариант становится верным:** если после CE-пилота фактически нужны granular roles или priority support и их цена ниже стоимости простоев/времени владельца. Для текущих трёх агентов и принятого бренда обоснования пока нет.

## Ответы на дополнительные вопросы

### 1. Какое auth-решение соразмерно трём сотрудникам

Минимум — отдельный случайный credential на агента/устройство, серверная проверка разговора, idempotency и audit. Его преимущество — 1–3 инженерных дня вместо изменения Chatwoot; недостаток — bearer можно украсть и он не доказывает активную Chatwoot-сессию. Более безопасный form-owned login с короткой session добавит примерно ещё 2–5 дней и login UX. Полный signed broker разумен только при более строгом threat model или расширении числа сотрудников/операций.

Собственная Chatwoot БД полезна для server-side верификации, но не должна становиться основным публичным контрактом. Предпочтителен API; чтение БД надо изолировать адаптером и покрыть тестами версии.

### 2. Реалистичны ли push на iPhone

Да, как web technology — но не в текущей cross-origin схеме. Наиболее реалистичен same-origin launcher + Chatwoot на физическом iPhone. Если штатный browser push Chatwoot не подписывает установленную web app корректно, единственный чистый путь с одной иконкой — launcher-owned Web Push bridge. Это уже отдельная интеграция, а не настройка manifest.

### 3. Реалистичный срок App Review

Планировать 6–10 недель после готовности демонстрационного стенда; держать резерв 10–12+ недель. Лучший случай 3–5 недель возможен, но не годится как committed launch date. Один отказ не является исключением, поэтому Business Suite должен оставаться официальным fallback до фактического approval и end-to-end production test.

### 4. Насколько comments подрывают переход

Неизвестно до измерения. При малой доле заказов comments можно принять как исключение с чётким параллельным процессом. При большой доле они отменяют обещание одного inbox и возвращают вторую иконку. Измерение должно предшествовать разработке, а не идти после запуска.

### 5. Достаточен ли выигрыш «форма рядом с перепиской»

Пока нет доказательств. При экономии 3–10 часов в месяц проект с 15–30 инженерными днями, App Review и постоянной эксплуатацией экономически слаб. При 20–25+ часах в месяц, дорогих ошибках или заметной потере заказов он может окупаться. Нужны реальные baseline и prototype timings.

### 6. Что было упущено полностью

- фактический `X-Frame-Options: SAMEORIGIN` и выбор единого origin;
- отсутствие service worker/push-кода в текущем лаунчере;
- превращение single-iframe launcher в shell с двумя разделами;
- конфликт service worker scope между launcher и Chatwoot;
- security/GDPR lifecycle и offboarding;
- delivery/error queue и token reauthorization;
- production SLO, RPO/RTO, restore и rollback;
- измеряемый business case;
- coexistence/handover Chatwoot и Business Suite;
- точная ценность Premium кроме branding.

## Рекомендация после сравнения

1. **Не начинать production build и не подавать App Review по текущему документу.**
2. На 2–4 инженерных дня сделать изолированный PoC: один EU Chatwoot instance, статический launcher на том же exact origin, физический iPhone, штатный browser push, cold/background/deep-link и Dashboard App без доступа к боевой Sheet.
3. Параллельно 7–14 дней измерить число заказов, время ручного переноса, ошибки и точную долю Facebook comments.
4. Если same-origin Gate A/B проходит и baseline показывает достаточный ROI, выбрать **self-hosted CE** и добавить минимальный per-agent auth, idempotency, operations/data plan и App Review matrix.
5. Если Gate A/B не проходит, сохранить Business Suite. Cloud и native Chatwoot технически проще, но не удовлетворяют жёсткому требованию одной иконки.
6. Premium сейчас не покупать: принятый логотип Chatwoot снимает его главное очевидное преимущество; вернуться к нему только при доказанной ценности support/roles.

Итог: направление self-hosted CE **потенциально реализуемо**, но только через same-origin архитектуру, которой в v4 ещё нет. Экономическая оправданность проекта остаётся недоказанной.

## Обязательные изменения для v5

- [ ] Заменить «лаунчер дорабатывается под новый адрес» на точную same-origin схему, routes, manifest scope и fallback.
- [ ] Зафиксировать Gate B как тест `X-Frame-Options`, session persistence и multi-app navigation на физическом iPhone.
- [ ] Описать Gate A с измеримыми push/badge/deep-link acceptance criteria.
- [ ] Выбрать минимальный auth tier, threat model, revoke/offboarding и негативные тесты.
- [ ] Описать `order_submission_id`, состояния заказа и retry contract.
- [ ] Зафиксировать Chatwoot release, Instagram login flow и permission matrix.
- [ ] Добавить App Review диапазон 6–10 недель и резерв 10–12+ недель.
- [ ] Вставить 7–14-дневное измерение comments и ручного труда как business gate.
- [ ] Добавить server-side identity resolver и не зависеть от недокументированного payload.
- [ ] Добавить security/GDPR retention/delete/export matrix.
- [ ] Добавить production budget €15–45/мес без труда, owner time, RPO/RTO, backup/restore и monitoring.
- [ ] Исправить описание Premium и указать годовую оплату.

