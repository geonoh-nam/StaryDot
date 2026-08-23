"""Move components and their styles out of App.js, one destination file at a time."""
import io, re, os

APP = 'App.js'

def read(p=APP):
    return io.open(p, encoding='utf-8').read()

def write(s, p=APP):
    io.open(p, 'w', encoding='utf-8').write(s)

def comment_start(text, i):
    start = i
    while True:
        prev = text.rfind('\n', 0, start - 1)
        line = text[prev + 1:start - 1] if prev >= 0 else text[:start - 1]
        if line.lstrip().startswith('//'):
            start = prev + 1
        else:
            return start

def take_component(src, name):
    """Cut `function Name(...) { ... }` plus the comment above it."""
    m = re.search(r'\nfunction ' + name + r'\(', src)
    if not m:
        raise KeyError(name)
    i = m.start() + 1
    # Skip the parameter list: its destructuring braces are not the body.
    k = src.index('(', m.end() - 1)
    depth = 0
    while True:
        if src[k] == '(': depth += 1
        elif src[k] == ')':
            depth -= 1
            if depth == 0:
                break
        k += 1
    k = src.index('{', k)
    depth = 0
    while k < len(src):
        if src[k] == '{': depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                end = src.index('\n', k) + 1
                break
        k += 1
    top = comment_start(src, i)
    return src[top:end].rstrip(), src[:top] + src[end:]

def take_const(src, name):
    """Cut a top-level `const NAME = ...;`, however deeply the value nests."""
    m = re.search(r'\nconst ' + name + r'\b', src)
    if not m:
        raise KeyError(name)
    i = m.start() + 1
    k = src.index('=', m.end())
    depth = 0
    while k < len(src):
        c = src[k]
        if c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        elif c == ';' and depth == 0:
            end = src.index('\n', k) + 1
            break
        k += 1
    top = comment_start(src, i)
    return src[top:end].rstrip(), src[:top] + src[end:]

def take_styles(src, names):
    """Cut named entries out of App.js's StyleSheet and return them as text."""
    out = []
    for n in names:
        m = re.search(r'\n  ' + n + r': \{\n(?:.*?\n)*?  \},', src)
        if not m:
            raise KeyError('style ' + n)
        out.append(m.group(0).lstrip('\n'))
        src = src[:m.start()] + src[m.end():]
    return '\n'.join(out), src

def unused_styles(src):
    head, tail = src.split('const styles = StyleSheet.create(', 1)
    names = re.findall(r'\n  ([a-zA-Z][a-zA-Z0-9]*): \{', tail)
    return [n for n in names if src.count('styles.' + n) == 0]


def take_memo(src, name):
    """Cut `const Name = React.memo(function Name(...) {...});` plus its comment."""
    m = re.search(r'\nconst ' + name + r' = React\.memo\(', src)
    if not m:
        raise KeyError(name)
    i = m.start() + 1
    k = src.index('(', m.end() - 1)
    depth = 0
    while k < len(src):
        if src[k] == '(': depth += 1
        elif src[k] == ')':
            depth -= 1
            if depth == 0:
                end = src.index('\n', k) + 1
                break
        k += 1
    top = comment_start(src, i)
    return src[top:end].rstrip(), src[:top] + src[end:]
