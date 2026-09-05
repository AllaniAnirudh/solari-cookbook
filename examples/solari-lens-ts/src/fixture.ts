/** Deploy as server.py. PORT=3000, HOST=0.0.0.0, CHECKOUT_DEFECT=1 (0 is healthy),
 * FIXTURE_LOG=fixture.jsonl. Handoff the returned /payment?checkout=... URL and
 * append &environment=desktop; environment is an observation marker, not identity.
 * Synthetic payment tokens are used; this fixture never processes real cards.
 */
export const fixtureServerSource = String.raw`
import html
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

DEFECT = os.environ.get("CHECKOUT_DEFECT", "1") == "1"
LOG = os.environ.get("FIXTURE_LOG", "fixture.jsonl")
STATES = {}
SHIPPING = {"name", "address", "city", "postalCode"}
EXPECTED = SHIPPING | {"paymentToken"}
KNOWN = EXPECTED | {"zipCode", "productId"}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def context(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        self.route = parsed.path
        self.checkout = query.get("checkout", [""])[0]
        marker = query.get("environment", ["unknown"])[0]
        self.marker = marker if marker in ("browser", "desktop") else "unknown"
        self.state = STATES.get(self.checkout)

    def url(self, path):
        return path + "?" + urlencode({"checkout": self.checkout, "environment": self.marker})

    def record(self, status, fields=(), missing=(), unexpected=(), code="ok"):
        # Never persist values, arbitrary keys, URLs, headers, or request bodies.
        safe = lambda keys: sorted({key if key in KNOWN else "[unknown]" for key in keys})
        row = {"event": "checkout.request", "method": self.command,
               "route": self.route if self.route in ("/", "/product", "/cart", "/shipping", "/payment", "/confirmation") else "[unknown]",
               "checkoutId": self.checkout if self.state is not None else None,
               "environment": self.marker, "status": status, "code": code,
               "fields": safe(fields), "expectedFields": sorted(EXPECTED) if self.route == "/payment" and self.command == "POST" else [],
               "missingFields": safe(missing), "unexpectedFields": safe(unexpected)}
        with open(LOG, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, sort_keys=True) + "\n")

    def send(self, status, body, kind="text/html; charset=utf-8", location=None):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(data)

    def page(self, title, body, status=200):
        self.send(status, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lens Checkout Fixture</title><style>body{font:16px system-ui;color:#20252a;max-width:640px;margin:32px auto;padding:0 20px}nav{margin-bottom:24px}label{display:block;margin:16px 0}input,select,button{font:inherit;padding:10px;max-width:100%;box-sizing:border-box}input{display:block;width:100%}button{background:#176b52;color:white;border:0;cursor:pointer}a{color:#176b52}[role=alert]{color:#ad2424}</style><nav>Lens Supply / Checkout</nav><h1>' + title + '</h1>' + body + '</html>')

    def form(self, path, contents, label):
        return '<form method="post" action="' + html.escape(self.url(path), quote=True) + '">' + contents + '<button type="submit">' + label + '</button></form>'

    def payment(self, error=False):
        fields = dict(self.state["shipping"])
        if DEFECT:
            fields["zipCode"] = fields.pop("postalCode")
        hidden = ''.join('<input type="hidden" name="' + key + '" value="' + html.escape(value, quote=True) + '">' for key, value in sorted(fields.items()))
        body = '<p>Field Notebook / $49.00</p><p>Shipping address saved.</p>'
        if error:
            body += '<p role="alert">Something went wrong. Payment could not be completed.</p>'
        body += self.form('/payment', hidden + '<label>Payment method<select name="paymentToken"><option value="test-card">Test card ending 4242</option></select></label>', 'Pay $49.00')
        self.page('Payment', body, 422 if error else 200)

    def do_GET(self):
        self.context()
        if self.route in ("/", "/product"):
            self.record(200)
            self.page('Field Notebook', '<p>Hardcover notebook / $49.00</p>' + self.form('/cart', '<input type="hidden" name="productId" value="notebook">', 'Add to cart'))
        elif self.state is None:
            self.record(404, code="checkout_not_found")
            self.page('Checkout not found', '<a href="/">View product</a>', 404)
        elif self.route == "/cart":
            self.record(200)
            self.page('Cart', '<p>1 Field Notebook / Total $49.00</p><a href="' + html.escape(self.url('/shipping')) + '">Continue to shipping</a>')
        elif self.route == "/shipping":
            self.record(200)
            inputs = ''.join('<label>' + label + '<input required name="' + key + '" maxlength="120"></label>' for key, label in [('name', 'Full name'), ('address', 'Street address'), ('city', 'City'), ('postalCode', 'Postal code')])
            self.page('Shipping', self.form('/shipping', inputs, 'Continue to payment'))
        elif self.route == "/payment" and "shipping" in self.state:
            self.record(200)
            self.payment()
        elif self.route == "/confirmation" and self.state.get("paid"):
            self.record(200)
            self.page('Order confirmed', '<p>Thank you. Your Field Notebook order is complete.</p><p>Order ' + self.checkout + '</p>')
        else:
            self.record(409, code="invalid_checkout_step")
            self.page('Checkout incomplete', '<p>Complete the preceding checkout step.</p>', 409)

    def do_POST(self):
        self.context()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError()
            raw = self.rfile.read(length).decode("utf-8")
            if self.headers.get_content_type() == "application/json":
                data = json.loads(raw)
            elif self.headers.get_content_type() == "application/x-www-form-urlencoded":
                pairs = parse_qs(raw, keep_blank_values=True, max_num_fields=30)
                if any(len(values) != 1 for values in pairs.values()):
                    raise ValueError()
                data = {key: values[0] for key, values in pairs.items()}
            else:
                raise ValueError()
            if not isinstance(data, dict) or any(not isinstance(value, str) or len(value) > 120 for value in data.values()):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.record(400, code="invalid_body")
            self.send(400, '{"error":"invalid_body"}', "application/json")
            return
        if self.route == "/cart" and data == {"productId": "notebook"}:
            self.checkout = "checkout-%04d" % (len(STATES) + 1)
            self.state = STATES[self.checkout] = {}
            target = "/cart"
        elif self.state is None:
            self.record(404, data, code="checkout_not_found")
            self.send(404, '{"error":"checkout_not_found"}', "application/json")
            return
        elif self.route == "/shipping" and set(data) == SHIPPING and all(value.strip() for value in data.values()):
            self.state["shipping"] = data
            self.state.pop("paid", None)
            target = "/payment"
        elif self.route == "/payment" and "shipping" in self.state:
            missing = EXPECTED - set(data)
            unexpected = set(data) - EXPECTED
            if missing or unexpected or any(not value.strip() for value in data.values()) or data.get("paymentToken") != "test-card" or any(data.get(key) != value for key, value in self.state["shipping"].items()):
                self.record(422, data, missing, unexpected, "schema_validation_failed")
                if self.headers.get_content_type() == "application/json":
                    self.send(422, json.dumps({"error": "schema_validation_failed", "missingFields": sorted(missing), "unexpectedFields": sorted(key if key in KNOWN else "[unknown]" for key in unexpected)}), "application/json")
                else:
                    self.payment(error=True)
                return
            self.state["paid"] = True
            target = "/confirmation"
        else:
            self.record(409, data, code="invalid_checkout_step")
            self.send(409, '{"error":"invalid_checkout_step"}', "application/json")
            return
        self.record(303, data)
        self.send(303, "", location=self.url(target))

if __name__ == "__main__":
    server = HTTPServer((os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "3000"))), Handler)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()
`

/** Deploy as analyze.py; invoke python3 analyze.py LOG EVIDENCE OUTPUT_DIR.
 * Evidence: {checkoutId, logArtifactId, artifacts:[{id,environment,type,state}],
 * observations:[{environment,checkoutId,outcome:'blocked'|'succeeded',artifactIds:[]}] }.
 * Observations are supplied assessments of ready screenshots, not image analysis.
 */
export const fixtureAnalyzerSource = String.raw`
import json
import re
import sys
from pathlib import Path

def analyze(log_path, evidence_path, output):
    limitations = []
    caveats = []
    try:
        evidence = json.loads(Path(evidence_path).read_text())
        if not isinstance(evidence, dict):
            raise ValueError()
    except (OSError, ValueError):
        evidence = {}
        limitations.append("Evidence index missing or invalid.")
    rows = []
    try:
        for line in Path(log_path).read_text().splitlines():
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError()
            rows.append(row)
    except (OSError, ValueError):
        limitations.append("Fixture logs missing or invalid.")
        rows = []
    artifacts = {}
    for item in evidence.get("artifacts", []) if isinstance(evidence.get("artifacts", []), list) else []:
        if isinstance(item, dict):
            key = item.get("id", item.get("artifactId"))
            if isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key) and item.get("state") == "ready":
                artifacts[key] = item
    log_id = evidence.get("logArtifactId")
    log = artifacts.get(log_id) if isinstance(log_id, str) else None
    if not log or log.get("environment") != "sandbox" or log.get("type") not in ("log", "fixture-log"):
        limitations.append("Ready fixture log artifact reference missing.")
        rows = []
    checkout = evidence.get("checkoutId")
    payments = [row for row in rows if isinstance(checkout, str) and row.get("checkoutId") == checkout and row.get("event") == "checkout.request" and row.get("method") == "POST" and row.get("route") == "/payment"]
    expected = sorted(["name", "address", "city", "postalCode", "paymentToken"])
    mismatch = [row for row in payments if row.get("status") == 422 and row.get("code") == "schema_validation_failed" and row.get("expectedFields") == expected and row.get("fields") == sorted(["name", "address", "city", "zipCode", "paymentToken"]) and row.get("missingFields") == ["postalCode"] and row.get("unexpectedFields") == ["zipCode"]]
    success = [row for row in payments if row.get("status") == 303 and row.get("code") == "ok" and row.get("fields") == expected]
    outcome = "blocked" if mismatch and not success else "succeeded" if success and not mismatch else None
    claims = []
    if outcome:
        claims.append({"summary": "Payment submitted zipCode; the server requires postalCode." if outcome == "blocked" else "Payment accepted the expected schema.", "artifactIds": [log_id], "provenance": "derived"})
    else:
        limitations.append("No unambiguous payment schema outcome for this checkout.")
    observations = evidence.get("observations", [])
    if not isinstance(observations, list):
        observations = []
    for environment in ("browser", "desktop"):
        refs = set()
        for observation in observations:
            if not isinstance(observation, dict) or observation.get("environment") != environment or observation.get("checkoutId") != checkout or observation.get("outcome") != outcome or not outcome:
                continue
            ids = observation.get("artifactIds", [])
            for key in ids if isinstance(ids, list) else []:
                item = artifacts.get(key) if isinstance(key, str) else None
                if item and item.get("environment") == environment and item.get("type") == "screenshot":
                    refs.add(key)
        matching_requests = [row for row in (mismatch if outcome == "blocked" else success) if row.get("environment") == environment]
        if not refs:
            limitations.append("Missing or inconsistent " + environment + " screenshot assessment evidence.")
        elif not matching_requests and environment == "desktop":
            caveats.append("Desktop screenshot assessment has no matching server request; it is independent visual confirmation of the failed interaction.")
        elif not matching_requests:
            limitations.append("Missing or inconsistent " + environment + " payment request evidence.")
        else:
            claims.append({"summary": environment.capitalize() + " assessment reports checkout " + outcome + ".", "artifactIds": sorted(refs) + [log_id], "provenance": "agent-reported"})

    caveats.append("Screenshot contents are assessed by the evidence producer; the analyzer does not independently inspect images.")
    result = {"diagnosis": "supported" if outcome and not limitations else "inconclusive", "checkoutOutcome": outcome or "unknown", "claims": claims, "artifactIds": sorted({key for claim in claims for key in claim["artifactIds"]}), "limitations": limitations, "caveats": caveats}
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "diagnosis.json").write_text(json.dumps(result, indent=2) + "\n")
    report = "# Checkout diagnosis: " + result["diagnosis"] + "\n\n"
    for claim in claims:
        report += "- " + claim["summary"] + " (" + claim["provenance"] + "; artifacts: " + ", ".join(claim["artifactIds"]) + ")\n"
    report += "\n## Limitations\n\n" + ("\n".join("- " + item for item in result["limitations"]) if result["limitations"] else "- None identified.") + "\n"
    report += "\n## Caveats\n\n" + "\n".join("- " + item for item in result["caveats"]) + "\n"
    (output / "report.md").write_text(report)
    return result

if __name__ == "__main__":
    print(json.dumps(analyze(*sys.argv[1:4])))
`
