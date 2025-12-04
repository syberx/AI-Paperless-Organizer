"""Default prompts for similarity analysis."""

DEFAULT_PROMPTS = {
    "correspondents": """Du bist ein Experte für die Analyse von Korrespondenten-Namen in einem Dokumentenmanagementsystem.

Analysiere die folgende Liste von Korrespondenten und gruppiere ähnliche Einträge, die sich auf dieselbe Person oder Firma beziehen.

Korrespondenten-Liste:
{items}

WICHTIGE Regeln:
1. Gruppiere NUR Einträge, die sich DEFINITIV auf dieselbe Entität beziehen
2. VORSICHT bei Abkürzungen: "BFS" könnte viele Firmen sein - nur gruppieren wenn klar ist, dass es dieselbe ist!
3. Der suggested_name MUSS einer der Mitglieder-Namen sein oder eine direkte Variante davon
4. NIEMALS einen Namen erfinden der nicht in der Liste vorkommt!
5. GmbH/AG-Zusätze und Schreibweisen sind OK (z.B. "Telekom" und "Deutsche Telekom AG")
6. Gib eine Konfidenz zwischen 0.0 und 1.0 an - bei Unsicherheit lieber NICHT gruppieren!

BEISPIEL für FALSCHES Gruppieren (NICHT machen!):
- "BFS" und "Bundesagentur für Arbeit" - NEIN! Das sind komplett verschiedene Firmen!
- "AOK" und "AXA" - NEIN! Nur weil beide mit A anfangen, sind sie nicht dieselbe Firma!

BEISPIEL für RICHTIGES Gruppieren:
- "Deutsche Telekom" und "Telekom Deutschland GmbH" - JA! Gleiche Firma, verschiedene Schreibweisen
- "1&1" und "1und1" und "1&1 Internet AG" - JA! Gleiche Firma

Antworte NUR mit validem JSON im folgenden Format:
{
  "groups": [
    {
      "suggested_name": "Vollständiger Firmenname GmbH",
      "confidence": 0.95,
      "members": ["name1", "name2", "name3"],
      "reasoning": "Kurze Begründung warum diese zusammengehören"
    }
  ]
}

Wenn keine ähnlichen Gruppen gefunden werden, gib zurück: {"groups": []}""",

    "tags": """Du bist ein Experte für die Analyse von Tags/Schlagwörtern in einem Dokumentenmanagementsystem.

Analysiere die folgende Liste von Tags und gruppiere ähnliche Einträge, die das gleiche Konzept beschreiben.

Tags-Liste:
{items}

Regeln:
1. Gruppiere Tags die das gleiche oder sehr ähnliche Konzept beschreiben
2. Berücksichtige Synonyme, Singular/Plural, verschiedene Schreibweisen
3. Der suggested_name sollte der klarste/gebräuchlichste Begriff sein
4. Gib eine Konfidenz zwischen 0.0 und 1.0 an

Antworte NUR mit validem JSON im folgenden Format:
{
  "groups": [
    {
      "suggested_name": "Bester Tag-Name",
      "confidence": 0.90,
      "members": ["tag1", "tag2", "tag3"],
      "reasoning": "Kurze Begründung warum diese zusammengehören"
    }
  ]
}

Wenn keine ähnlichen Gruppen gefunden werden, gib zurück: {"groups": []}""",

    "document_types": """Du bist ein Experte für die Analyse von Dokumententypen in einem Dokumentenmanagementsystem.

Analysiere die folgende Liste von Dokumententypen und gruppiere NUR Einträge, die exakt den gleichen Dokumenttyp beschreiben (verschiedene Schreibweisen).

Dokumententypen-Liste:
{items}

WICHTIGE Regeln:
1. Gruppiere NUR exakt gleiche Dokumenttypen mit verschiedenen Schreibweisen!
2. NIEMALS verschiedene Kategorien zusammenlegen, auch wenn sie ähnlich klingen!
3. Der suggested_name sollte der gebräuchlichste/klarste Begriff sein
4. Bei Unsicherheit: NICHT gruppieren!

FALSCHES Gruppieren (NIEMALS machen!):
- "Lohnabrechnung" und "Abrechnung" - NEIN! Lohnabrechnung ist eine spezifische Kategorie!
- "Rechnung" und "Lohnabrechnung" - NEIN! Komplett verschiedene Dokumenttypen!
- "Stromrechnung" und "Rechnung" - NEIN! Stromrechnung ist spezifischer!
- "Mietvertrag" und "Vertrag" - NEIN! Mietvertrag ist eine spezifische Vertragsart!
- "Kontoauszug" und "Abrechnung" - NEIN! Verschiedene Dokumenttypen!
- "Bescheid" und "Brief" - NEIN! Ein Bescheid ist kein normaler Brief!

RICHTIGES Gruppieren (NUR solche Fälle!):
- "Rechnung" und "Invoice" und "Rechnungen" - JA! Gleicher Typ, verschiedene Sprachen/Plural
- "Vertrag" und "Verträge" und "Contract" - JA! Gleicher Typ
- "Lohnabrechnung" und "Gehaltsabrechnung" und "Lohn-Abrechnung" - JA! Gleicher Typ
- "KFZ-Brief" und "Fahrzeugbrief" - JA! Gleicher Typ

Das Ziel ist Duplikate zu entfernen, NICHT Kategorien zu vereinfachen!

Antworte NUR mit validem JSON im folgenden Format:
{
  "groups": [
    {
      "suggested_name": "Bester Dokumententyp-Name",
      "confidence": 0.92,
      "members": ["typ1", "typ2", "typ3"],
      "reasoning": "Kurze Begründung warum diese zusammengehören"
    }
  ]
}

Wenn keine ähnlichen Gruppen gefunden werden, gib zurück: {"groups": []}""",

    "tags_nonsense": """Du bist ein Experte für Dokumentenmanagement und analysierst Tags auf ihre Sinnhaftigkeit.

Analysiere diese Tags und identifiziere UNSINNIGE Tags, die gelöscht werden sollten.

Tags-Liste (Name: Anzahl Dokumente):
{items}

Ein Tag ist UNSINNIG wenn es:
- Zu generisch/nichtssagend ist (z.B. "Dokument", "Datei", "Sonstiges", "Allgemein")
- Ein offensichtlicher Tippfehler oder Fragment ist
- Nur aus Zahlen, einzelnen Buchstaben oder Sonderzeichen besteht
- Ein temporärer/Test-Tag ist (z.B. "test", "tmp", "neu", "todo")
- Keinen semantischen Wert für die Dokumentenorganisation hat
- Redundant ist, weil es bereits als Korrespondent oder Dokumententyp existieren sollte

WICHTIG: Tags mit vielen Dokumenten (>10) nur mit hoher Sicherheit markieren!

Antworte NUR mit validem JSON:
{
  "nonsense_tags": [
    {
      "name": "Tag-Name",
      "confidence": 0.95,
      "reason": "Kurze Begründung warum unsinnig"
    }
  ]
}

Wenn keine unsinnigen Tags gefunden werden: {"nonsense_tags": []}""",

    "tags_are_correspondents": """Du bist ein Experte für Dokumentenmanagement.

Analysiere diese Tags und identifiziere Tags, die eigentlich KORRESPONDENTEN (Firmen/Personen) sind und nicht als Tag verwendet werden sollten.

Tags-Liste:
{items}

Existierende Korrespondenten zum Vergleich:
{correspondents}

Ein Tag sollte ein Korrespondent sein wenn es:
- Ein Firmenname ist (GmbH, AG, Inc, Ltd, etc.)
- Ein Personenname ist
- Eine Organisation oder Institution ist
- Bereits als Korrespondent existiert (nur andere Schreibweise)

Antworte NUR mit validem JSON:
{
  "correspondent_tags": [
    {
      "tag_name": "Tag-Name",
      "suggested_correspondent": "Passender Korrespondent oder neuer Name",
      "confidence": 0.90,
      "reason": "Begründung"
    }
  ]
}

Wenn keine solchen Tags gefunden werden: {"correspondent_tags": []}""",

    "tags_are_document_types": """Du bist ein Experte für Dokumentenmanagement.

Analysiere diese Tags und identifiziere Tags, die eigentlich DOKUMENTENTYPEN sind und nicht als Tag verwendet werden sollten.

Tags-Liste:
{items}

Existierende Dokumententypen zum Vergleich:
{document_types}

Ein Tag sollte ein Dokumententyp sein wenn es:
- Eine Dokumentart beschreibt (Rechnung, Vertrag, Brief, Bescheid, etc.)
- Bereits als Dokumententyp existiert (nur andere Schreibweise)
- Das Format oder die Art eines Dokuments beschreibt

Antworte NUR mit validem JSON:
{
  "doctype_tags": [
    {
      "tag_name": "Tag-Name",
      "suggested_doctype": "Passender Dokumententyp oder neuer Name",
      "confidence": 0.90,
      "reason": "Begründung"
    }
  ]
}

Wenn keine solchen Tags gefunden werden: {"doctype_tags": []}"""
}

