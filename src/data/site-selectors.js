// 站点选择器数据
// 功能：内置站点配置

export const SITE_SELECTORS = [
  {
    name: 'beqege/bigee/bqgui',
    hostname: 'beqege.cc',
    toc: '#list',
    chapters: 'dl dd > a[href]',
    chaptersAlt: 'dl center.clear ~ dd > a[href]',
    content: ['div#content', '#chaptercontent', '.content'],
    title: '#maininfo #info h1',
    bookInfo: '#maininfo #info'
  },
  {
    name: 'listmain',
    hostname: 'bqgui.cc',
    toc: '.listmain',
    chapters: 'dl dd > a[href]',
    content: ['#chaptercontent', 'div#content', '.content'],
    title: '.info h1',
    bookInfo: 'div.book div.info'
  },
  {
    name: 'list-chapter',
    hostname: 'bqgui.cc',
    toc: '.list-chapter',
    chapters: 'div.booklist > ul > li > a[href]',
    content: ['.content', 'div#content', '#chaptercontent'],
    title: 'h1',
    bookInfo: 'h1'
  },
  {
    name: 'biquge.net',
    hostname: 'biquge.net',
    toc: 'div.section-box',
    chapters: 'div.section-box ul.section-list li > a[href]',
    content: ['div.reader-main', 'div#content', '#chaptercontent', '.content', '#htmlContent'],
    title: 'h1',
    bookInfo: '#info, .book-info, .small'
  },
  {
    name: 'snapd.net',
    hostname: 'snapd.net',
    toc: 'dl',
    tocPattern: '最新章节列表',
    chapters: 'dl > dd > a[href*="/read/"]',
    content: ['#chaptercontent', 'div#content', '.content'],
    title: 'h1',
    bookInfo: 'h1'
  },
  {
    name: 'alicesw.com',
    hostname: 'alicesw.com',
    toc: 'ul.mulu_list',
    chapters: 'ul.mulu_list > li > a[href]',
    content: ['.read-content', 'div#content', '#chaptercontent', '.content'],
    title: 'h1',
    bookInfo: 'h1'
  },
  {
    name: '3haitang.com',
    hostname: '3haitang.com',
    toc: 'ul',
    tocPattern: '最新章节列表',
    chapters: 'ul > li > a[href]',
    content: ['#content', '#htmlContent', 'div#content', '#chaptercontent', '.content'],
    title: 'h1',
    bookInfo: 'h1'
  },
  {
    name: 'shibashiwu.net',
    hostname: 'shibashiwu.net',
    toc: 'ul',
    tocPattern: '正文',
    chapters: 'ul > li > a[href]',
    content: ['#C0NTENT', 'div#content', '#chaptercontent', '.content'],
    title: 'h1',
    bookInfo: 'h1'
  },
  {
    name: 'hbdafeng.com',
    hostname: 'hbdafeng.com',
    toc: 'section.BCsectionTwo',
    tocPattern: '正文',
    chapters: 'ol.BCsectionTwo-top > li > a[href]',
    content: ['div.C0NTENT', 'div#content', '#chaptercontent', '.content'],
    title: 'h1',
    bookInfo: 'h1'
  }
];
