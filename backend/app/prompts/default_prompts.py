"""Default prompts for similarity analysis."""

DEFAULT_PROMPTS = {
    "correspondents": """Du bist ein Experte für die Analyse von Korrespondenten-Namen in einem Dokumentenmanagementsystem.

Analysiere die folgende Liste und finde Gruppen von ÄHNLICHEN Korrespondenten die zusammengelegt werden könnten.

Korrespondenten-Liste:
{items}

WICHTIG - NUR Gruppen mit MINDESTENS 2 verschiedenen Einträgen erstellen!

Suche nach:
1. Gleiche Firma mit verschiedenen Schreibweisen (z.B. "Telekom" und "Deutsche Telekom AG")
2. Gleiche Person mit verschiedenen Schreibweisen
3. Abkürzungen und ausgeschriebene Formen (z.B. "1&1" und "1und1")
4. Mit/ohne GmbH, AG, etc.

BEISPIELE für gute Gruppen (IMMER mindestens 2 Members!):
- ["Deutsche Telekom", "Telekom Deutschland GmbH"] → Gleiche Firma
- ["1&1", "1und1", "1&1 Internet AG"] → Gleiche Firma
- ["Amazon", "Amazon.de", "Amazon EU"] → Gleiche Firma

KEINE Gruppen mit nur 1 Eintrag erstellen!
Schreibe die Member-Namen EXAKT wie sie in der Liste stehen!

Antworte NUR mit validem JSON:
{
  "groups": [
    {
      "suggested_name": "Bester Name",
      "confidence": 0.9,
      "members": ["name1", "name2"],
      "reasoning": "Begründung"
    }
  ]
}

Bei keinen Ähnlichkeiten: {"groups": []}""",

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

Analysiere die folgende Liste von Dokumententypen und finde Gruppen von ÄHNLICHEN Einträgen die zusammengelegt werden könnten.

Dokumententypen-Liste:
{items}

WICHTIG - NUR Gruppen mit MINDESTENS 2 verschiedenen Einträgen erstellen!

Suche nach:
1. Gleiche Typen mit verschiedenen Schreibweisen (z.B. "Rechnung" und "Invoice")
2. Singular/Plural-Varianten (z.B. "Vertrag" und "Verträge")  
3. Verwandte Dokumenttypen die konsolidiert werden könnten (z.B. "Auftrag", "Auftragsbestätigung")
4. Abkürzungen und ausgeschriebene Formen (z.B. "KFZ-Brief" und "Fahrzeugbrief")

BEISPIELE für gute Gruppen (IMMER mindestens 2 Members!):
- ["Rechnung", "Invoice", "Rechnungen"] → Gleiche Typen
- ["Auftrag", "Auftragsbestätigung", "Bestellung"] → Verwandte Typen
- ["Lohnabrechnung", "Gehaltsabrechnung"] → Synonyme

KEINE Gruppen mit nur 1 Eintrag erstellen!
Schreibe die Member-Namen EXAKT wie sie in der Liste stehen!

Antworte NUR mit validem JSON:
{
  "groups": [
    {
      "suggested_name": "Bester Name",
      "confidence": 0.85,
      "members": ["name1", "name2"],
      "reasoning": "Begründung"
    }
  ]
}

Bei keinen Ähnlichkeiten: {"groups": []}""",

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

