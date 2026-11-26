"""AUG-1791: youtube_shelf and the place survive "Upload config" and a new build; saver_every must be at least 1.

Fake values in temporary folders; the servers listen on 127.0.0.1 and nothing leaves this Mac.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import webapp  # noqa: E402
from test_aug1786 import KEY, Live  # noqa: E402  (the servers, and the TV's sealed upload)


class Config(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = os.path.join(self.dir, 'config.properties')

    def write(self, **values):
        webapp.write_values(self.path, values)


class SaverEvery(Config):
    def test_problems_wants_at_least_one_whole_number(self):
        for bad in ('0', '00', '-1', '1.5', 'x', '²', '٣'):
            self.assertTrue(webapp.problems({'saver_every': bad}), bad)
        for good in ('1', '5', '60'):
            self.assertEqual(webapp.problems({'saver_every': good}), [], good)
        self.assertEqual(webapp.problems({'saver_every': ''}), [])   # empty is the default

    def test_saver_minutes_may_still_be_zero(self):
        self.assertEqual(webapp.problems({'saver_minutes': '0'}), [])

    def test_the_build_stops_on_it(self):
        self.write(saver_every='0')
        with self.assertRaises(SystemExit) as e:
            webapp.read_config(self.path)
        self.assertIn('saver_every', str(e.exception))


class Settings(Config):
    def test_youtube_shelf_reaches_config_js(self):
        self.write(youtube_shelf='com.a, com.b', shelf='com.c')
        config = webapp.read_config(self.path)
        self.assertEqual(config['youtubeShelf'], ['com.a', 'com.b'])
        self.assertEqual(config['shelf'], ['com.c'])

    def test_generic_has_it_empty(self):
        self.assertEqual(webapp.config_from_args(['--generic'])['youtubeShelf'], [])

    def test_the_place_in_the_file_wins_over_the_city(self):
        self.write(city='Springfield', latitude='60.39', longitude='5.32')
        with mock.patch.object(webapp, 'locate', side_effect=AssertionError('no lookup')):
            config = webapp.read_config(self.path)
        self.assertEqual((config['latitude'], config['longitude'], config['city']), ('60.39', '5.32', 'Springfield'))


class Upload(Live):
    """The TV's upload (sealed, AUG-1786) to a real setup server, accepted on the page's API."""

    values = {'setup_key': KEY}

    def write(self, **values):
        webapp.write_values(self.path, values)

    def test_youtube_shelf_and_the_place_survive_upload_and_a_new_build(self):
        # What the TV sends (names as in config.js; the place's numbers are strings, as Open-Meteo's are).
        self.upload({'youtubeShelf': ['com.a', 'com.b'], 'latitude': '60.39', 'longitude': '5.32', 'city': 'Bergen'})
        self.assertEqual(self.accept()[0], 200)
        config = webapp.read_config(self.path)
        self.assertEqual(config['youtubeShelf'], ['com.a', 'com.b'])
        self.assertEqual((config['latitude'], config['longitude'], config['city']), ('60.39', '5.32', 'Bergen'))

    def test_automatic_place_clears_the_old_one(self):
        self.write(latitude='60.39', longitude='5.32', city='Bergen')
        self.upload({'latitude': '', 'longitude': '', 'city': ''})
        self.assertEqual(self.accept()[0], 200)
        values = webapp.read_values(self.path)
        self.assertEqual((values['latitude'], values['longitude'], values['city']), ('', '', ''))

    def test_a_place_that_is_not_a_number_is_refused_and_the_file_is_kept(self):
        before = open(self.path, 'rb').read()
        self.upload({'latitude': 'north', 'longitude': '5.32'})
        status, body = self.accept()
        self.assertEqual(status, 400)
        self.assertIn('latitude', json.dumps(body))
        self.assertEqual(open(self.path, 'rb').read(), before)

    def test_saver_every_zero_from_the_tv_is_refused(self):
        self.upload({'saverEvery': 0})
        status, body = self.accept()
        self.assertEqual(status, 400)
        self.assertIn('saver_every', json.dumps(body))
        self.assertNotIn('saver_every=0', open(self.path, encoding='utf-8').read())


class Rectification(Upload):
    """After verification: a new city drops the old place; ranges; a cap on saver_every."""

    def save(self, values):
        return self.call(self.server, 'POST', '/api/config', {'values': values}, {'X-Setup': self.server.key})

    def test_changing_the_city_on_the_page_clears_the_uploaded_place(self):
        self.upload({'latitude': '60.39', 'longitude': '5.32', 'city': 'Bergen'})
        self.assertEqual(self.accept()[0], 200)
        self.assertEqual(self.save({'city': 'Oslo'})[0], 200)
        values = webapp.read_values(self.path)
        self.assertEqual((values['city'], values['latitude'], values['longitude']), ('Oslo', '', ''))

    def test_saving_the_same_city_keeps_the_place(self):
        self.write(latitude='60.39', longitude='5.32', city='Bergen')
        self.assertEqual(self.save({'city': 'Bergen', 'name': 'Anna'})[0], 200)
        values = webapp.read_values(self.path)
        self.assertEqual((values['latitude'], values['longitude'], values['name']), ('60.39', '5.32', 'Anna'))

    def test_a_new_city_without_an_old_place_adds_no_empty_lines(self):
        self.assertEqual(self.save({'city': 'Oslo'})[0], 200)
        self.assertNotIn('latitude', webapp.read_values(self.path))

    def test_ranges_ascii_and_both_or_neither(self):
        ok = {'latitude': '-89.5', 'longitude': '179'}
        self.assertEqual(webapp.problems(ok), [])
        for bad in ({'latitude': '91', 'longitude': '5'}, {'latitude': '-90.5', 'longitude': '5'},
                    {'latitude': '60', 'longitude': '181'}, {'latitude': '\u0666\u0660', 'longitude': '5'},
                    {'latitude': '60', 'longitude': ''}, {'latitude': '', 'longitude': '5'}):
            self.assertTrue(webapp.problems(bad), bad)

    def test_saver_every_has_a_cap(self):
        self.assertEqual(webapp.problems({'saver_every': '1440'}), [])
        for bad in ('1441', '99999999', '9' * 5000):
            self.assertTrue(webapp.problems({'saver_every': bad}), bad[:12])


if __name__ == '__main__':
    unittest.main()
