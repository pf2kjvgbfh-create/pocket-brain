# Prints the signed header (certificate chain) and the action list of a signed .shortcut file (AEA1).
# Usage: pip install pyliblzfse; python tools/shortcuts/inspect-signed.py public/shortcuts/<name>.shortcut
import sys, struct, plistlib, json, liblzfse, re
raw = open(sys.argv[1], 'rb').read()
assert raw[:4] == b'AEA1', 'no AEA1'
hlen = struct.unpack('<I', raw[8:12])[0]
hdr = plistlib.loads(raw[12:12+hlen])
chain = hdr.get('SigningCertificateChain', [])
print('signed header keys:', list(hdr), 'certs:', len(chain))
for c in chain:
    m = re.findall(rb'(Apple[ -~]{3,60})', c)
    print('  cert:', sorted(set(x.decode() for x in m))[:3])
i = min([p for p in (raw.find(b'bvx2'), raw.find(b'bvxn'), raw.find(b'bvx-'), raw.find(b'bvx1')) if p >= 0])
end = raw.find(b'bvx$', i) + 4
aa = liblzfse.decompress(raw[i:end])
p = aa.find(b'bplist00')
if p < 0: p = aa.find(b'<?xml')
wf = plistlib.loads(aa[p:])
print('name in archive files:', re.findall(rb'[\w.-]+\.wflow', aa)[:3])
print('inputs:', wf.get('WFWorkflowInputContentItemClasses') if len(wf.get('WFWorkflowInputContentItemClasses', []))<3 else len(wf['WFWorkflowInputContentItemClasses']))
for a in wf['WFWorkflowActions']:
    print(' ', a['WFWorkflowActionIdentifier'], sorted(a["WFWorkflowActionParameters"]))
