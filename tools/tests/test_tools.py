"""Smoke tests for the Python tools: each script compiles, does nothing but define things when imported, and imports.

Run: python3 -B -m unittest discover -s tools/tests (tools/check.sh does; -B keeps __pycache__ out of the repo).
"""
import ast
import glob
import importlib.util
import os
import sys
import unittest

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOLS = os.path.join(ROOT, 'tools')
SCRIPTS = sorted(glob.glob(os.path.join(TOOLS, '*.py')) + glob.glob(os.path.join(ROOT, 'tizen', '*.py')))
# What a script may call at its top level besides defining things.
TOP_LEVEL_CALLS = ('sys.path.insert', 'GENERIC.update')


def rel(path):
    return os.path.relpath(path, ROOT)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


class Scripts(unittest.TestCase):
    def test_found(self):
        self.assertIn(os.path.join(ROOT, 'tizen', 'build.py'), SCRIPTS)
        self.assertIn(os.path.join(TOOLS, 'webapp.py'), SCRIPTS)

    def test_each_compiles(self):
        for path in SCRIPTS:
            with self.subTest(rel(path)):
                compile(read(path), rel(path), 'exec')

    def test_top_level_only_defines(self):
        """Importing a script must not run it: its work sits behind `if __name__ == '__main__'`."""
        for path in SCRIPTS:
            with self.subTest(rel(path)):
                for node in ast.parse(read(path), rel(path)).body:
                    if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef, ast.Assign,
                                         ast.AnnAssign)):
                        continue
                    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
                        continue   # the docstring
                    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and \
                            ast.unparse(node.value.func) in TOP_LEVEL_CALLS:
                        continue
                    if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'":
                        continue
                    self.fail('%s:%d runs at import: %s' % (rel(path), node.lineno, ast.unparse(node)[:80]))

    def test_each_imports(self):
        for path in SCRIPTS:
            with self.subTest(rel(path)):
                name = 'frametv_test_' + os.path.splitext(os.path.basename(path))[0]
                spec = importlib.util.spec_from_file_location(name, path)
                module = importlib.util.module_from_spec(spec)
                try:
                    spec.loader.exec_module(module)
                except ModuleNotFoundError as e:
                    # A package that isn't part of Python (Pillow for make_symbols.py) is the script's own business.
                    if e.name and e.name.split('.')[0] not in sys.stdlib_module_names and \
                            not os.path.exists(os.path.join(TOOLS, e.name + '.py')):
                        self.skipTest('%s needs %s' % (rel(path), e.name))
                    raise


class GenericBuild(unittest.TestCase):
    """The config the check and the Node tests build with: no config.properties, no secrets."""

    def test_generic_config_has_no_secrets(self):
        sys.path.insert(0, TOOLS)
        import webapp
        config = webapp.config_from_args(['--generic'])
        self.assertTrue(config['stasera'])
        for key, value in config.items():
            if any(word in key.lower() for word in ('token', 'key', 'secret')):
                self.assertFalse(value, key)


if __name__ == '__main__':
    unittest.main()
