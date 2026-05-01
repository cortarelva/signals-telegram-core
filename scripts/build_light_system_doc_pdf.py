from pathlib import Path
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_FILE = OUTPUT_DIR / "torus-ai-trading-system-overview-pt.pdf"
DB_PATH = ROOT / "runtime" / "runtime-store.sqlite"


def register_fonts():
    font_path = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
    if font_path.exists():
        pdfmetrics.registerFont(TTFont("ArialUnicode", str(font_path)))
        return "ArialUnicode"
    return "Helvetica"


BASE_FONT = register_fonts()


def make_styles():
    styles = getSampleStyleSheet()

    styles.add(
        ParagraphStyle(
            name="DocTitle",
            parent=styles["Title"],
            fontName=BASE_FONT,
            fontSize=24,
            leading=30,
            textColor=colors.HexColor("#0F172A"),
            alignment=TA_CENTER,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="DocSubTitle",
            parent=styles["Normal"],
            fontName=BASE_FONT,
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#475569"),
            alignment=TA_CENTER,
            spaceAfter=18,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=styles["Heading2"],
            fontName=BASE_FONT,
            fontSize=15,
            leading=20,
            textColor=colors.HexColor("#0F172A"),
            spaceBefore=6,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Body",
            parent=styles["BodyText"],
            fontName=BASE_FONT,
            fontSize=10,
            leading=15,
            textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["BodyText"],
            fontName=BASE_FONT,
            fontSize=8.5,
            leading=12,
            textColor=colors.HexColor("#334155"),
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Callout",
            parent=styles["BodyText"],
            fontName=BASE_FONT,
            fontSize=10,
            leading=15,
            textColor=colors.white,
            backColor=colors.HexColor("#0F766E"),
            borderPadding=(8, 10, 8),
            spaceBefore=6,
            spaceAfter=12,
        )
    )
    return styles


STYLES = make_styles()


def p(text, style="Body"):
    return Paragraph(text, STYLES[style])


def bullet_lines(items):
    return "<br/>".join([f"• {item}" for item in items])


def build_area_table():
    rows = [
        [
            p("<b>Área</b>", "Small"),
            p("<b>O que faz</b>", "Small"),
            p("<b>Pastas / conteúdos principais</b>", "Small"),
        ],
        [
            p("<b>Runtime</b>", "Small"),
            p("Motor live, gestão de risco, estado, execução e espelho SQLite.", "Small"),
            p("`runtime/` com `torus-ai-trading.js`, `futures-executor.js`, `risk-manager.js`, `state.json`, `orders-log.json`, `runtime-store.sqlite` e `config/`.", "Small"),
        ],
        [
            p("<b>Estratégias</b>", "Small"),
            p("Regras de seleção e scoring dos setups por família de estratégia.", "Small"),
            p("`strategies/` com módulos como `cipher-continuation-long`, `cipher-continuation-short`, `oversold-bounce`, `failed-breakdown` e agregador em `index.js`.", "Small"),
        ],
        [
            p("<b>Research</b>", "Small"),
            p("Backtests, datasets, replay histórico, presets TradFi e treino de meta-modelos.", "Small"),
            p("`research/` com builders, runners, artefactos JSON/CSV, `meta-models/` e `cache/`.", "Small"),
        ],
        [
            p("<b>Otimização</b>", "Small"),
            p("Varreduras e ajustes automáticos de parâmetros.", "Small"),
            p("`optimization/` e estudos auxiliares para tuning e auto-adaptação.", "Small"),
        ],
        [
            p("<b>Dashboards</b>", "Small"),
            p("Interfaces de monitorização para operação local e visão pública.", "Small"),
            p("`dashboard/`, `dashboard-public/` e servidores em `runtime/dashboard-server.js` e `runtime/dashboard-public-server.js`.", "Small"),
        ],
        [
            p("<b>Indicadores</b>", "Small"),
            p("Cálculo de EMA, RSI, ATR, ADX e utilidades de mercado.", "Small"),
            p("`indicators/` com a camada matemática reutilizada por runtime e research.", "Small"),
        ],
        [
            p("<b>Docs e operação</b>", "Small"),
            p("Notas de contexto, processos operacionais e documentação auxiliar.", "Small"),
            p("`docs/`, `scripts/`, `scheduler/`, `tests/`, `logs/`, `output/`, mais áreas de apoio como `archive/` e `files_novos/`.", "Small"),
        ],
    ]

    table = Table(rows, colWidths=[32 * mm, 52 * mm, 92 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#94A3B8")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def build_db_table():
    rows = [
        [p("<b>Campo</b>", "Small"), p("<b>Registo atual</b>", "Small")],
        [p("Motor de base de dados", "Small"), p("SQLite local", "Small")],
        [p("Ficheiro principal", "Small"), p(str(DB_PATH), "Small")],
        [p("Ficheiros auxiliares", "Small"), p(str(DB_PATH) + "-wal<br/>" + str(DB_PATH) + "-shm", "Small")],
        [p("Override por ambiente", "Small"), p("`SQLITE_DB_PATH` (não configurado no `.env`; usa o path default acima)", "Small")],
        [p("Modo de acesso", "Small"), p("Ficheiro local. Não existe host, porta, username ou password separados.", "Small")],
        [p("Bootstrap", "Small"), p("`npm run sqlite:bootstrap`", "Small")],
        [p("Comando de inspeção", "Small"), p(f'`sqlite3 "{DB_PATH}"`', "Small")],
        [p("Tabelas principais", "Small"), p("`json_files`, `state_latest`, `orders_log`, `execution_metrics`, `json_array_events`", "Small")],
    ]

    table = Table(rows, colWidths=[48 * mm, 124 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DBEAFE")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#93C5FD")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#BFDBFE")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def add_page_number(canvas, doc):
    page = canvas.getPageNumber()
    canvas.setFont(BASE_FONT, 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(195 * mm, 10 * mm, f"Página {page}")
    canvas.drawString(15 * mm, 10 * mm, "TorusAiTrading")


def build_story():
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")

    story = []
    story.extend(
        [
            Spacer(1, 22 * mm),
            p("Visão Geral do Sistema", "DocTitle"),
            p("TorusAiTrading", "DocSubTitle"),
            p(
                "Documento leve de referência para operação, manutenção e leitura rápida do projeto.",
                "DocSubTitle",
            ),
            Spacer(1, 8 * mm),
            p(
                "Este sistema é um motor de trading quantitativo orientado para Binance Futures, com componentes de geração de sinais, filtros de estratégia, execução, controlo de risco, monitorização em dashboard, espelho de dados em SQLite e uma área de research para backtests, datasets, presets TradFi e treino de meta-modelos.",
                "Body",
            ),
            p(
                f"<b>Root do projeto:</b> {ROOT}<br/><b>Gerado em:</b> {generated_at}",
                "Small",
            ),
            Spacer(1, 10 * mm),
            p(
                bullet_lines(
                    [
                        "Lê candles de mercado e constrói contexto técnico (EMA, RSI, ATR, ADX, estrutura de mercado e suporte/resistência).",
                        "Avalia várias estratégias modulares e decide quais setups são executáveis, watch ou ignore.",
                        "Executa em paper ou Binance real, com sizing por risco, limites de exposição e registo de ordens.",
                        "Mantém dashboard local, estado live, métricas de execução e espelho SQLite para consulta rápida.",
                        "Tem laboratório de research para backtests, replay histórico, datasets rotulados, ML e presets TradFi.",
                    ]
                ),
                "Callout",
            ),
        ]
    )

    story.extend(
        [
            p("O Que o Sistema Faz", "SectionTitle"),
            p(
                "No modo live, o motor percorre o universo de símbolos ativos, calcula o contexto técnico, executa os filtros das estratégias e, se as condições forem satisfeitas, abre ou fecha posições com base nas regras de risco. Em paralelo, persiste o estado operacional, mantém logs de execução e alimenta o dashboard.",
                "Body",
            ),
            p(
                "No modo research, o mesmo projeto suporta backtests históricos, replay candle a candle, builders de datasets, presets de estratégias e modelos de ML usados como filtros complementares. Isto permite evoluir o bot sem misturar diretamente a operação live com o laboratório de melhoria.",
                "Body",
            ),
            p("Fluxo resumido", "SectionTitle"),
            p(
                bullet_lines(
                    [
                        "Mercado -> candles e contexto técnico.",
                        "Contexto -> avaliação das estratégias ativas por símbolo e timeframe.",
                        "Estratégias -> score, classe do sinal e geometria da trade (entry / stop / target).",
                        "Risco e execução -> sizing, limites operacionais, ordens e atualizações de estado.",
                        "Persistência e observabilidade -> JSON live, SQLite mirror, logs, dashboard e artefactos de research.",
                    ]
                ),
                "Body",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            p("Áreas e Pastas Principais", "SectionTitle"),
            p(
                "A estrutura abaixo resume as áreas que importam mais para desenvolvimento, operação e análise. O objetivo não é listar tudo exaustivamente, mas mostrar o mapa funcional do projeto e o que se encontra em cada zona.",
                "Body",
            ),
            build_area_table(),
            Spacer(1, 8 * mm),
            p(
                "Na prática, `runtime/` e `strategies/` são o núcleo operacional; `research/` e `optimization/` são o laboratório; `dashboard/` e `dashboard-public/` são a camada de visibilidade; e `docs/` / `tests/` garantem contexto e segurança de evolução.",
                "Small",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            p("Camadas de Trabalho", "SectionTitle"),
            p(
                "Operação live: corre o bot, mantém o dashboard, gere risco, posições abertas, execução real/paper e espelho SQLite. Tudo o que mexe com trades em aberto passa por esta camada.",
                "Body",
            ),
            p(
                "Research e melhoria: produz backtests, datasets rotulados, meta-modelos, presets TradFi e relatórios. É aqui que são afinadas ou validadas novas ideias antes de qualquer promoção para o runtime live.",
                "Body",
            ),
            p(
                "TradFi research separado: o projeto já tem um laboratório próprio para equities/ETF via Twelve Data, com presets e runners independentes do runtime cripto. Isto permite testar `AAPLUSDT`, `QQQUSDT` e `SPYUSDT` sem contaminar a config live principal.",
                "Body",
            ),
            KeepTogether(
                [
                    p("Artefactos úteis do dia a dia", "SectionTitle"),
                    p(
                        bullet_lines(
                            [
                                "`runtime/state.json` para saber posições abertas, histórico e signal log.",
                                "`runtime/orders-log.json` e `runtime/execution-metrics.json` para auditoria operacional.",
                                "`runtime/runtime-store.sqlite` para consulta rápida estruturada do estado espelhado.",
                                "`research/*.json` e `research/*.csv` para estudos, presets e resultados de backtest.",
                                "`output/pdf/` para documentação gerada e entregáveis do projeto.",
                            ]
                        ),
                        "Body",
                    ),
                ]
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            p("Registo de Acesso à Base de Dados", "SectionTitle"),
            p(
                "Hoje o sistema não usa uma base de dados remota tradicional. O registo persistente principal é um espelho SQLite local, alimentado a partir das escritas JSON do runtime. Por isso, os dados de acesso abaixo correspondem ao método real de acesso em produção local.",
                "Body",
            ),
            build_db_table(),
            Spacer(1, 6 * mm),
            p(
                "Nota: além da SQLite, o projeto continua a manter ficheiros JSON como fonte operacional de estado (`state.json`, `orders-log.json`, `execution-metrics.json`). A base SQLite existe para consulta, espelho e reporting mais robusto - não como um serviço externo com credenciais separadas.",
                "Small",
            ),
        ]
    )

    return story


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Visão Geral do Sistema",
        author="Codex",
    )
    doc.build(build_story(), onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(OUTPUT_FILE)


if __name__ == "__main__":
    main()
