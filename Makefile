# Makefile for hvernig-eignast-eg-hus

SHELL  := /bin/bash
PYTHON := .venv/bin/python3

.PHONY: dev install test

dev:
	$(PYTHON) -m flask --app app run --debug --port 5004

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

# Python tests for the web app, Node tests for the calculations in static/calc.js
test:
	$(PYTHON) -m unittest discover -s tests -v
	node --test tests/
