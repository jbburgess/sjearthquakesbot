'''
Collection of Azure Functions for the Reddit bot /u/SJEarthquakesBot.

This file contains the following Azure Functions:
    - post_news: Scheduled Azure Function to check the Earthquakes news site
      and post new articles to subreddit.
    - get_schedule: Scheduled Azure Function to check the Earthquakes match
      schedule and trigger match thread functions when needed.
    - post_match_thread: On-demand (HTTP) Azure Function to post match threads.

This file also contains the following internal functions:
    - _get_flair_template: Internal function to retrieve a link flair template from
      subreddit by flair text.
    - _get_newsarticles: Internal function to parse news articles from the
      Earthquakes website News page.
    - _get_submissions: Internal function to retrieve recent posts in subreddit and filter
      to threads matching the provided name, flair, and stickied status.
    - _http_request: Internal function to make HTTP requests.
    - _init_reddit_connection: Internal function to initialize the reddit 
      connection to the configured subreddit.
    - _unsticky_match_thread: Internal function to unsticky match threads.
'''

import datetime
import gc
import json
import logging
import os
import sys
import time
from typing import Optional
from urllib import request
from zoneinfo import ZoneInfo

import azure.functions as func
from bs4 import BeautifulSoup
from icalendar import Calendar
import praw
import requests
import tzdata

app = func.FunctionApp()

@app.schedule(schedule="0 */5 0-3,14-23 * * *", arg_name="timer", run_on_startup=False,
              use_monitor=False)
def post_news(timer: func.TimerRequest) -> None:
    '''
    Scheduled Azure Function to check the Earthquakes news site and post new articles to the subreddit.

    Args:
        timer: The Azure Function timer trigger.

    Returns:
        None

    Raises:
        Any exceptions encountered when initializing the reddit connection, retrieving subreddit posts, or posting articles.
    '''

    utc_timestamp = datetime.datetime.utcnow().replace(
        tzinfo=datetime.timezone.utc).isoformat()

    logging.debug('Python timer trigger function ran at %s', utc_timestamp)

    # Initialize environmental variables.
    resubmit = os.environ["Reddit_Submission_Resubmit"]
    send_replies = os.environ["Reddit_Submission_SendReplies"]
    subreddit = os.environ["Reddit_Subreddit"]

    cutoff_days = int(os.environ["NewsSite_ArticleCutoffDays"])

    cutoffutc = datetime.datetime.utcnow() - datetime.timedelta(days = cutoff_days)

    #Retrieve new articles from Earthquakes website.
    articles = _get_newsarticles()

    # Connect to subreddit if new articles were found.
    if articles:
        try:
            reddit = _init_reddit_connection()
            subreddit = reddit.subreddit(subreddit)
        except:
            logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
            raise

        # Retrieve recent posts in subreddit
        subreddit_urls = []

        try:
            logging.debug('Retrieving subreddit posts.')

            for submission in subreddit.new(limit=50):
                normalized_url = submission.url.lower()
                subreddit_urls.append(normalized_url)
        except:
            logging.error('Unexpected error when retrieving subreddit posts:%s', sys.exc_info()[0])
            raise

        # Retrieve removed links in subreddit
        removed_urls = []

        try:
            logging.debug('Retrieving removed subreddit links.')

            for log in subreddit.mod.log(action='removelink',limit=20):
                actiontimestamp = datetime.datetime.utcfromtimestamp(log.created_utc)
                if actiontimestamp < cutoffutc:
                    logging.debug('Removal action is old, skipping: %s', log.target_title)
                else:
                    submission = reddit.submission(log.target_fullname.lstrip('t3_'))
                    normalized_url = submission.url.lower()
                    removed_urls.append(normalized_url)
                    logging.debug('Link added: %s', submission.url)
        except:
            logging.error('Unexpected error when retrieving removed subreddit links:%s', sys.exc_info()[0])
            raise

        # Process each article.
        if subreddit_urls:
            for article in articles:
                # Skip article already posted to subreddit.
                if article['link'] in subreddit_urls:
                    logging.debug('Article already posted, skipping: %s', article['title'])
                else:
                    # Skip article if it was already posted and then removed by mods.
                    if article['link'] in removed_urls:
                        logging.info('Article already posted and then removed by mods, skipping: %s', article['title'])
                    else:
                        # Build submission parameter splat.
                        submit_params = {
                            'title': article['title'],
                            'url': article['link'],
                            'flair_id': _get_flair_template("Official Source"),
                            'resubmit': resubmit,
                            'send_replies': send_replies
                        }

                        # Submit new post to subreddit.
                        try:
                            subreddit.submit(**submit_params)
                        except praw.exceptions.RedditAPIException as exception:
                            for subexception in exception.items:
                                if subexception.error_type == 'ALREADY_SUB':
                                    logging.critical('Error encountered when posting article (%s): Article has already been posted, but was not caught by list comparison.', article["title"])
                                    raise
                                else:
                                    logging.error('Unexpected Reddit API error encountered when posting article (%s): %s, %s', article["title"], subexception.error_type, subexception.message)
                                    raise
                        except:
                            logging.error('Unexpected error when posting article (%s): %s', article["title"], sys.exc_info()[0])
                            raise
                        else:
                            logging.info('New article successfully posted: %s', article['title'])
            del subreddit_urls
            del removed_urls
        else:
            logging.warning('No subreddit post URLs retrieved.')

        del articles
    else:
        logging.info('No new articles retrieved from news site.')

    # Sleep for configured interval before checking for news again.
    gc.collect()

# Scheduled Azure Function to check Earthquakes match schedule and trigger match thread Function when needed.
@app.schedule(schedule="0 */5 0-3,14-23 * * *", arg_name="timer", run_on_startup=False, use_monitor=False)
def get_schedule(timer: func.TimerRequest) -> None:
    '''
    Scheduled Azure Function to check the Earthquakes match schedule and trigger match thread functions when needed.
    
    Args:
        timer: The Azure Function timer trigger.
        
    Returns:
        None
        
    Raises:
        Any exceptions encountered when initializing the reddit connection, retrieving subreddit posts, or calling match thread functions.
    '''

    now = datetime.datetime.now(datetime.timezone.utc)
    logging.info("Now: %s", now.isoformat())

    # Initialize environmental variables
    schedule_url = os.environ["Schedule_URL"]
    thread_function_url = os.environ["Reddit_MatchThread_FunctionURL"]

    # Retrieve .ics file from website and parse events.
    logging.info("Retrieving .ics file from website: %s", schedule_url)
    response = requests.get(schedule_url, timeout = 10)


    if response.status_code == 200:
        logging.info("Retrieved .ics file")
        ics_data = response.text
        calendar = Calendar.from_ical(ics_data)
        events = []
        for component in calendar.walk():
            if component.name == "VEVENT":
                event = {
                    "summary": component.get("summary"),
                    "start": component.get("dtstart").dt,
                    "end": component.get("dtend").dt,
                    "location": component.get("location"),
                    "description": component.get("description"),
                }
                events.append(event)
    else:
        raise ValueError("Failed to retrieve .ics file")

    # Filter to events happening only in the window of interest.
    if events:
        logging.info("Parsed %s events from calendar", len(events))
        yesterday = now + datetime.timedelta(hours = -26, minutes = -2.5)
        tomorrow = now + datetime.timedelta(hours = 12, minutes = 2.5)
        events = [event for event in events if isinstance(event["start"], datetime.datetime) and event["start"] > yesterday and event["start"] < tomorrow]
    else:
        logging.warning("No events found in calendar")

    # Process filtered events and call appropriate match thread functions
    if events:
        logging.info("Found events in current window: %s", events)

        # Check event time relative to now and call match thread function for appropriate thread type as needed.
        for event in events:
            try:
                # Initialize data to be sent to match thread function
                data = {
                    "event": event
                }
                
                if event["start"] < now + datetime.timedelta(hours = 12, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = 12, minutes = -2.5):
                    logging.info("Posting prematch thread for event: %s, %s", event["summary"], event["start"])
                    data["type"] = "prematch"
                    data["stickied"] = True
                    _http_request(thread_function_url, "POST", data)
                elif event["start"] < now + datetime.timedelta(hours = 1, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = 1, minutes = -2.5):
                    logging.info("Posting match thread for event: %s, %s", event["summary"], event["start"])
                    data["type"] = "match"
                    data["stickied"] = True
                    data["suggested_sort"] = "new"
                    _http_request(thread_function_url, "POST", data)
                elif event["start"] < now + datetime.timedelta(hours = -2, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = -2, minutes = -2.5):
                    logging.info("Posting postmatch and MOTM threads for event: %s, %s", event["summary"], event["start"])
                    data["type"] = "postmatch"
                    data["stickied"] = True
                    _http_request(thread_function_url, "POST", data)
                    time.sleep(5)
                    data["type"] = "motm"
                    data["stickied"] = False
                    data["suggested_sort"] = "new"
                    _http_request(thread_function_url, "POST", data)
                elif event["start"] < now + datetime.timedelta(hours = -26, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = -26, minutes = -2.5):
                    logging.info("Unstickying match threads for event: %s, %s", event["summary"], event["start"])
                    _unsticky_match_threads(event)
                else:
                    logging.info("Event outside of window of interest: %s, %s", event["summary"], event["start"])
            except:
                logging.error("Unexpected error when processing event: %s, %s", event["summary"], event["start"])
    else:
        logging.warning("No events found in current window")

# On-demand (HTTP) Azure Function to post match threads.
@app.route(methods = ["POST"], auth_level = func.AuthLevel.FUNCTION)
def post_match_thread(req: func.HttpRequest) -> func.HttpResponse:
    '''
    On-demand (HTTP) Azure Function to post match threads.
    
    Args:
        req: The Azure Function HTTP request.
        
    Returns:
        A response indicating the success or failure of the match thread posting.
        
    Raises:
        Any exceptions encountered when initializing the reddit connection, retrieving subreddit posts, or posting match threads.
        
    Notes:
        The POST request body should contain a JSON object with the following properties:
            - event: The event to post the match thread for.
            - type: The type of match thread to post, which should be one of the following:
                - prematch
                - match
                - postmatch
                - motm
            - stickied: A boolean indicating whether the match thread should be stickied.
            - suggested_sort: The suggested sort for the match thread, if applicable.
    '''

    # Retrieve request data.
    req_body = req.get_json()
    event = req_body.get('event')
    thread_type = req_body.get('type')
    stickied = req_body.get('stickied')
    suggested_sort = req_body.get('suggested_sort')
    logging.info('Received request to post %s thread for event: %s, %s', thread_type, event["summary"], event["start"])

    # Initialize environmental variables.
    send_replies = os.environ["Reddit_Submission_SendReplies"]
    subreddit = os.environ["Reddit_Subreddit"]

    # Convert event start time to datetime object.
    start_datetime = datetime.datetime.fromisoformat(event['start'])

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except Exception:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        return func.HttpResponse("Internal Server Error", status_code = 500)

    if thread_type == "prematch":
        title = "Pre-Match Thread: " + event["summary"] + f' ({start_datetime.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%I:%M %p")})'
        flair_id = _get_flair_template("Pre Match")
        selftext = ""
    elif thread_type == "match":
        title = "Match Thread: " + event["summary"] + f' ({start_datetime.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%I:%M %p")})'
        flair_id = _get_flair_template("Match Thread")

        if event["description"].startswith("WATCH LIVE NOW: "):
            selftext = "MLS Season Pass livestream: " + event['description'].split(": ")[1]
        else:
            selftext = ""
    elif thread_type == "postmatch":
        title = "Post-Match Thread: " + event["summary"]
        flair_id = _get_flair_template("Post Match")
        selftext = ""
    elif thread_type == "motm":
        title = "Man of the Match: " + event["summary"]
        flair_id = _get_flair_template("Man of the Match")
        selftext = "One top-level comment for each player. Duplicates will be removed. \
            If there's already a comment for the player you want to nominate, feel free \
            to upvote that and add any additional thoughts in a reply underneath the original comment; \
            open discussion on nominees is welcome outside of top-level nominations."
    else:
        logging.error('Invalid thread type: %s', thread_type)
        return func.HttpResponse("Bad Request", status_code = 400)

    # Submit match thread to subreddit.
    submit_params = {
        'title': title,
        'flair_id': flair_id,
        'selftext': selftext,
        'send_replies': send_replies
    }

    try:
        logging.info('Posting thread with following params: %s', submit_params)
        submission = subreddit.submit(**submit_params)
    except Exception:
        logging.error('Unexpected error when posting match thread (%s): %s', title, sys.exc_info()[0])
        return func.HttpResponse("Internal Server Error", status_code = 500)
    
    # Set suggested sort if specified.
    if suggested_sort:
        try:
            submission.mod.suggested_sort(suggested_sort)
        except Exception:
            logging.error('Unexpected error when setting suggested sort for match thread (%s): %s', title, sys.exc_info()[0])
            return func.HttpResponse("Internal Server Error", status_code = 500)

    # Sticky match thread if specified.
    if stickied:
        try:
            submission.mod.sticky(state = True, bottom = True)
        except Exception:
            logging.error('Unexpected error when stickying match thread (%s): %s', title, sys.exc_info()[0])
            return func.HttpResponse("Internal Server Error", status_code = 500)
        else:
            logging.info('Match thread successfully stickied: %s', title)
            return func.HttpResponse("Match thread successfully posted and stickied", status_code = 200)
    else:
        logging.info('Match thread successfully posted: %s', title)
        return func.HttpResponse("Match thread successfully posted", status_code = 200)

# Internal function to retrieve a link flair template from subreddit by flair text.
def _get_flair_template(flair_text: str) -> str:
    '''
    Retrieve a link flair template from subreddit by flair text.

    Args:
        flair_text: The text of the flair to retrieve the template for.

    Returns:
        The template ID of the flair.

    Raises:
        Any exceptions encountered when initializing the reddit connection or retrieving the flair template.
    '''

    logging.debug('Retrieving flair template: %s', flair_text)

    # Initialize environmental variables.
    subreddit = os.environ["Reddit_Subreddit"]

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        raise

    # Retrieve flair template from subreddit
    try:
        flair = subreddit.flair.link_templates
        template = [template for template in flair if template["text"].lower() == flair_text.lower()]
        logging.debug('Flair template ID for %s retrieved: %s', flair_text, template[0]["id"])
    except:
        logging.error('Unexpected error when retrieving flair template:%s', sys.exc_info()[0])
        raise

    return template[0]["id"]

# Internal function to retrieve news articles from Earthquakes website.
def _get_newsarticles():
    '''
    Retrieve news articles from Earthquakes website.

    Args:
        None

    Returns:
        A list of dictionaries containing the news articles.

    Raises:
        Any exceptions encountered when retrieving news articles.
    '''

    # Initialize environmental variables.
    base_url = os.environ["NewsSite_BaseURL"]
    news_url = base_url + os.environ["NewsSite_NewsURL"]
    max_articles = int(os.environ["NewsSite_MaxArticles"])
    cutoff_days = int(os.environ["NewsSite_ArticleCutoffDays"])

    # Retrieve Earthquakes website news page and parse text articles.
    headers = {"User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.9.2.8) Gecko/20100722 Firefox/3.6.8 GTB7.1 (.NET CLR 3.5.30729)", "Referer": "http://example.com"}
    page = requests.get(news_url, headers=headers, timeout=5)
    soup = BeautifulSoup(page.content, 'html.parser')
    results = soup.find("section", class_='d3-l-grid--outer d3-l-section-row')
    article_elems = results.find_all("div", class_='d3-l-col__col-3')

    if article_elems:
        cutoffutcutc = datetime.datetime.utcnow() - datetime.timedelta(days = cutoff_days)
        articles = []

        for article_elem in article_elems[:max_articles]:
            # Parse article information.
            title = article_elem.a['title']
            href = article_elem.a['href']
            link = base_url + href

            # If article is a "NEWS:" post and not a duplicate, add to articles array.
            if "NEWS: " in title:
                if link in [i['link'] for i in articles]:
                    logging.debug('Duplicate article skipped: %s', title)
                else:
                    # Retrieve timestamp from article page.
                    articlepage = requests.get(link, timeout = 10)
                    articlesoup = BeautifulSoup(articlepage.content, 'html.parser')
                    timestamp_elem = articlesoup.find('div', class_='oc-c-article__date')
                    timestamp = timestamp_elem.p['data-datetime']
                    articledate = datetime.datetime.strptime(timestamp, '%m/%d/%Y %H:%M:%S')

                    if articledate < cutoffutcutc:
                        logging.debug('Old article skipped: %s', title)
                    else:
                        article = {
                            'title': title,
                            'link': link,
                            'timestamp': timestamp
                        }
                        articles.append(article)
                        logging.info('Article added: %s', title)
            else:
                logging.debug('Non-news article skipped: %s', title)

        del article_elems
    else:
        logging.critical('No article elements found on news site.')

    del page
    del soup
    del results

    return articles

# Internal function to retrieve the current MLS standings and team stats.
def _get_standings() -> dict:
    '''
    Retrieve the current MLS standings and team stats.

    Args:
        None

    Returns:
        A dictionary containing the current MLS standings and team stats.

    Raises:
        Any exceptions encountered when retrieving the current MLS standings and team stats.
    '''

    # Initialize environmental variables.
    standings_url = os.environ["StatsSite_Standings_URL"]

    # Retrieve current MLS standings and team stats.
    headers = {"User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.9.2.8) Gecko/20100722 Firefox/3.6.8 GTB7.1 (.NET CLR 3.5.30729)", "Referer": "http://example.com"}
    page = requests.get(standings_url, headers=headers, timeout=5)
    soup = BeautifulSoup(page.content, 'html.parser')
    standings = soup.find("div", id="all_Regular Season")
    tables = standings.find_all("table")

    data = []

    # Parse and combine the Eastern and Western Conference standings tables into a single dictionary.
    for table in tables:
        if table.attrs['id'].endswith("-Conference_overall"):
            table_body = table.find('tbody')
            rows = table_body.find_all('tr')

            for row in rows:
                entry = []
                rankcell = row.find('th')
                entry.append({rankcell.attrs['data-stat']: rankcell.text.strip()})
                cells = row.find_all('td')
                for ele in cells:
                    entry.append({ele.attrs['data-stat']: ele.text.strip()})
                data.append(entry)
    
    return data

# Internal function to retrieve recent posts in subreddit and filter to threads matching the provided name, flair, and stickied status.
def _get_submissions(name: str, flair: Optional[str] = None, stickied: Optional[bool] = None) -> list:
    '''
    Retrieve recent posts in subreddit and filter to threads matching the provided name, flair, and stickied status.

    Args:
        name: The name of the thread to filter to.
        flair: The flair of the thread to filter to.
        stickied: The stickied status of the thread to filter to.

    Returns:
        A list of dictionaries containing the filtered threads.

    Raises:
        Any exceptions encountered when initializing the reddit connection or retrieving subreddit posts.
    '''

    logging.debug('Retrieving subreddit posts: name = %s, flair = %s, stickied = %s', name, flair, stickied)

    # Initialize environmental variables.
    subreddit = os.environ["Reddit_Subreddit"]

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        raise

    # Retrieve recent posts in subreddit
    submissions = []

    try:
        logging.debug('Retrieving subreddit posts.')

        for submission in subreddit.new(limit=100):
            submission_dict = {
                "author": submission.author.name,
                "created": submission.created_utc,
                "id": submission.id,
                "link_flair_text": submission.link_flair_text,
                "name": submission.name,
                "permalink": submission.permalink,
                "stickied": submission.stickied,
                "title": submission.title.lower(),
            }

            submissions.append(submission_dict)
    except:
        logging.error('Unexpected error when retrieving subreddit posts:%s', sys.exc_info()[0])
        raise

    if submissions:
        # Filter to threads matching the provided name.
        submissions = [submission for submission in submissions if name.lower() in submission['title'].lower()]

        # If a flair was provided, filter to threads matching the provided flair.
        if flair:
            submissions = [submission for submission in submissions if submission['link_flair_text'] and flair.lower() in submission['link_flair_text'].lower()]

        # If stickied is provided, filter to threads matching the provided stickied status.
        if stickied:
            submissions = [submission for submission in submissions if submission['stickied'] == stickied]
    else:
        logging.error('No subreddit posts retrieved.')

    logging.debug('Subreddit posts filtered to: %s', submissions)
    return submissions

# Internal function to make HTTP requests.
def _http_request(url, method, data: Optional[dict] = None) -> bytes:
    '''
    Make HTTP requests.
    
    Args:
        url: The URL to make the request to.
        method: The method to use for the request.
        data: The data to send with the request.
        
    Returns:
        The content of the response.
        
    Raises:
        Any exceptions encountered when making the request.
    '''

    logging.debug('Making HTTP request: url = %s, method = %s, data = %s', url, method, data)

    req = request.Request(url, method = method)
    req.add_header('Content-Type', 'application/json')

    if data:
        data = json.dumps(data, default=lambda o: o.isoformat() if isinstance(o, datetime.datetime) else o)
        data = data.encode()
        with request.urlopen(req, data = data) as r:
            content = r.read()
    else:
        with request.urlopen(req) as r:
            content = r.read()

    return content

# Internal function to initialize the reddit connection to the configured subreddit.
def _init_reddit_connection() -> praw.Reddit:
    '''
    Initialize the reddit connection to the configured subreddit.

    Args:
        None

    Returns:
        The initialized reddit connection.

    Raises:
        Any exceptions encountered when initializing the reddit connection.
    '''

    # Initialize environmental variables.
    user_agent = os.environ["Reddit_Connection_UserAgent"]
    client_id = os.environ["Reddit_Connection_ClientID"]
    client_secret = os.environ["Reddit_Connection_ClientSecret"]
    username = os.environ["Reddit_Connection_Username"]
    password = os.environ["Reddit_Connection_Password"]

    # Connect to reddit
    try:
        logging.debug('Initializing reddit connection.')

        reddit = praw.Reddit(
            user_agent = user_agent,
            client_id = client_id,
            client_secret = client_secret,
            username = username,
            password = password,
        )
    except:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        raise

    return reddit

# Internal function to unsticky match threads.
def _unsticky_match_threads(event):
    '''
    Unsticky any stickied match threads.

    Args:
        event: The event to unsticky the match thread for.
    
    Returns:
        None

    Raises:
        Any exceptions encountered when initializing the reddit connection or unstickying match threads.
    '''

    logging.debug('Unstickying match threads for event: %s, %s', event["summary"], event["start"])

    # Initialize environmental variables.
    subreddit = os.environ["Reddit_Subreddit"]

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except:
        logging.error('Unexpected error when initializing reddit connection and subreddit:%s', sys.exc_info()[0])
        raise

    stickied_threads = _get_submissions(event["summary"], flair = "Match", stickied = True)

    if stickied_threads:
        logging.debug('Unstickying match threads: %s', stickied_threads)

        for thread in stickied_threads:
            try:
                submission = reddit.submission(thread["id"])
                submission.mod.sticky(state = False, bottom = False)
            except:
                logging.error('Unexpected error when unstickying match thread:%s', sys.exc_info()[0])
                raise

            logging.info('Match thread unstickied: %s', thread["title"])
